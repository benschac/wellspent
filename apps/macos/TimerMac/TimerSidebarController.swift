import AppKit
import LiquidUI
import Observation
import QuartzCore
import SwiftUI

@MainActor
@Observable
final class TimerSidebarController {
    var focusShortcutError: String?
    @ObservationIgnored let focusModel = FocusModel()
    @ObservationIgnored let focusAuth = FocusAuthModel()
    @ObservationIgnored private var focusWindow: NSWindow?
    private(set) var isVisible = false
    private(set) var isDragging = false
    private(set) var placement: TimerSidebarPlacement
    var isPositionLocked: Bool {
        didSet { defaults.set(isPositionLocked, forKey: "sidebarPositionLocked") }
    }
    var magneticEdges: Bool {
        didSet { defaults.set(magneticEdges, forKey: "sidebarMagneticEdges") }
    }

    private(set) var horizontal: CGFloat = 0
    private(set) var detachment: CGFloat = 0
    private(set) var shapeEdge: TimerSidebarEdge = .right
    private(set) var floatingFlip: CGFloat = 1
    private(set) var bodyOrigin = CGPoint.zero
    private(set) var bridgeAnchor: CGPoint?
    var geometry: TimerSidebarGeometry {
        TimerSidebarGeometry(horizontal: horizontal, floatingFlip: floatingFlip, detachment: detachment)
    }

    @ObservationIgnored private let model: TimerModel
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var railPanel: TimerFloatingPanel?
    @ObservationIgnored private var settingsWindow: NSWindow?
    @ObservationIgnored private var mainWindow: NSWindow?
    @ObservationIgnored private var pointerTask: Task<Void, Never>?
    @ObservationIgnored private var mouseMonitors: [Any] = []
    @ObservationIgnored private var lastVisibleFrame: CGRect?
    @ObservationIgnored private let motionClock = TimerMotionClock()
    @ObservationIgnored private var dragOrigin = CGPoint.zero
    @ObservationIgnored private var latestPointer = CGPoint.zero
    @ObservationIgnored private var dragOffset = CGPoint.zero
    @ObservationIgnored private var dragByRing = true
    @ObservationIgnored private var dragStartHorizontal: CGFloat = 0
    @ObservationIgnored private var dragStartDetachment: CGFloat = 0
    @ObservationIgnored private var dragEdge: TimerSidebarEdge?
    @ObservationIgnored private var hasPendingDrag = false
    @ObservationIgnored private var bodyFrame = CGRect.zero
    @ObservationIgnored private var attachmentPoint: CGPoint?
    @ObservationIgnored private var dragAttachmentPoint: CGPoint?
    @ObservationIgnored private var detachmentHaptic = TimerDetachmentHaptic()

    init(model: TimerModel, defaults: UserDefaults = .standard) {
        self.model = model
        self.defaults = defaults
        isPositionLocked = defaults.bool(forKey: "sidebarPositionLocked")
        magneticEdges = defaults.object(forKey: "sidebarMagneticEdges") as? Bool ?? true
        if let data = defaults.data(forKey: "sidebarPlacement"),
            let saved = try? JSONDecoder().decode(TimerSidebarPlacement.self, from: data), saved.isValid
        {
            placement = saved
        } else {
            placement = TimerSidebarPlacement(displayID: defaults.string(forKey: "sidebarDisplay"))
        }
    }

    func prepareFocus() async {
        focusModel.authenticatedConnection = { [weak self] in
            guard let self else { throw CancellationError() }
            return try await self.focusAuth.connection()
        }
        focusModel.authenticationRejected = { [weak self] in self?.focusAuth.requireSignIn() }
        focusAuth.accountChanged = { [weak self] in
            guard let self else { return }
            self.focusModel.configureAccount(
                apiBaseURL: self.model.apiBaseURL,
                userID: self.focusAuth.user?.id, available: self.focusAuth.canAccess)
        }
        await focusAuth.configure(apiBaseURL: model.apiBaseURL)
    }

    func restore() {
        if defaults.object(forKey: "sidebarVisible") as? Bool ?? true { show() }
    }

    func toggleVisibility() {
        if isVisible { hide() } else { show() }
    }

    func show() {
        if railPanel == nil {
            let rail = TimerFloatingPanel(size: TimerSidebarLayout.size(for: placement.edge))
            rail.host(TimerSidebarView().environment(model).environment(self))
            rail.setAccessibilityLabel("Floating timer")
            railPanel = rail
        }
        isVisible = true
        defaults.set(true, forKey: "sidebarVisible")
        reposition()
        railPanel?.orderFrontRegardless()
        startWatchingPointer()
    }

    func hide() {
        isVisible = false
        defaults.set(false, forKey: "sidebarVisible")
        stopWatchingPointer()
        stopSettling()
        railPanel?.orderOut(nil)
    }

    func toggleTimer() {
        if model.isRunning { model.pause() } else { model.startOrResume() }
    }

    func holdPosition() { stopSettling() }

    func clickTimer() {
        toggleTimer()
        // A click can interrupt a spring without becoming a drag. Resume its
        // destination after mouse-up instead of leaving a half-morphed widget.
        if let screen = selectedScreen() {
            settle(to: TimerSidebarLayout.frame(for: placement, in: screen.visibleFrame))
        }
    }

    func beginDragging(at point: CGPoint) {
        guard let panel = railPanel else { return }
        stopSettling()
        dragOrigin = point
        latestPointer = point
        dragStartHorizontal = horizontal
        dragStartDetachment = detachment
        dragEdge = placement.edge
        let local = CGPoint(x: point.x - bodyFrame.minX, y: bodyFrame.maxY - point.y)
        if detachment == 0, let edge = placement.edge {
            switch edge {
            case .right: attachmentPoint = CGPoint(x: bodyFrame.maxX, y: bodyFrame.midY)
            case .left: attachmentPoint = CGPoint(x: bodyFrame.minX, y: bodyFrame.midY)
            case .top: attachmentPoint = CGPoint(x: bodyFrame.midX, y: bodyFrame.maxY)
            case .bottom: attachmentPoint = CGPoint(x: bodyFrame.midX, y: bodyFrame.minY)
            }
        }
        dragAttachmentPoint = attachmentPoint
        detachmentHaptic.begin(attached: dragEdge != nil, gap: attachmentGap(from: bodyFrame) ?? .infinity)
        let ring = geometry.ring
        let label = geometry.label
        dragByRing = hypot(local.x - ring.x, local.y - ring.y) < hypot(local.x - label.x, local.y - label.y)
        let anchor = dragByRing ? ring : label
        dragOffset = CGPoint(x: local.x - anchor.x, y: local.y - anchor.y)
        isDragging = true
        panel.ignoresMouseEvents = false
        // Window Server caches transparent-window shadows. Do not carry a
        // previous, taller outline through the interactive resize.
        panel.hasShadow = false
        motionClock.tick = { [weak self] _ in self?.renderDrag() }
        if let view = panel.contentView { motionClock.start(in: view) }
    }

    func updateDrag(to point: CGPoint) {
        latestPointer = point
        hasPendingDrag = true
    }

    private func renderDrag() {
        guard isDragging, railPanel != nil else { return }
        guard hasPendingDrag else { return }
        hasPendingDrag = false
        if let dragEdge, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let translation = CGPoint(x: latestPointer.x - dragOrigin.x, y: latestPointer.y - dragOrigin.y)
            if let contact = dragAttachmentPoint {
                attachmentPoint = CGPoint(
                    x: contact.x + (dragEdge.isHorizontal ? translation.x : 0),
                    y: contact.y + (dragEdge.isHorizontal ? 0 : translation.y))
            }
            let progress = TimerSidebarGeometry.detachment(edge: dragEdge, translation: translation)
            horizontal = dragStartHorizontal + (1 - dragStartHorizontal) * progress
            detachment = dragStartDetachment + (1 - dragStartDetachment) * progress
        }
        present(geometry.frame(holding: latestPointer, offset: dragOffset, byRing: dragByRing))
        if let gap = attachmentGap(from: bodyFrame), detachmentHaptic.update(gap: gap) {
            // Synchronize with the drawing pass that displays the broken neck.
            NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .drawCompleted)
        }
    }

    func endDragging() {
        guard isDragging, let panel = railPanel else { return }
        renderDrag()
        let screen =
            NSScreen.screens.first(where: { $0.frame.contains(latestPointer) })
            ?? panel.screen ?? selectedScreen()
        isDragging = false
        guard let screen else {
            stopSettling()
            return
        }
        let originEdge = shapeEdge
        let floatingFrame = TimerSidebarGeometry(horizontal: 1, floatingFlip: floatingFlip)
            .frame(holding: latestPointer, offset: dragOffset, byRing: dragByRing)
        placement = TimerSidebarLayout.placement(
            afterDropping: floatingFrame, in: screen.visibleFrame,
            displayID: screenIdentifier(screen), magneticEdges: magneticEdges,
            preferredEdge: placement.edge
        )
        placement.floatingOriginEdge = placement.edge ?? originEdge
        savePlacement()
        lastVisibleFrame = screen.visibleFrame
        settle(to: TimerSidebarLayout.frame(for: placement, in: screen.visibleFrame))
        if placement.edge != nil {
            NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        }
    }

    private func settle(to target: CGRect) {
        guard let panel = railPanel else { return }
        panel.hasShadow = false
        let start = bodyFrame
        let startHorizontal = horizontal
        let startDetachment = detachment
        let startFlip = floatingFlip
        let targetHorizontal: CGFloat = placement.edge?.isHorizontal == false ? 0 : 1
        let targetDetachment: CGFloat = placement.edge == nil ? 1 : 0
        let edge = placement.edge ?? placement.floatingOriginEdge ?? .right
        let targetFlip: CGFloat = edge == .right ? 1 : 0
        if edge != shapeEdge { attachmentPoint = nil }
        if let attachedEdge = placement.edge {
            // Establish the wall contact for reattachment too, including a
            // widget restored in the middle of the display after relaunch.
            switch attachedEdge {
            case .right: attachmentPoint = CGPoint(x: target.maxX, y: target.midY)
            case .left: attachmentPoint = CGPoint(x: target.minX, y: target.midY)
            case .top: attachmentPoint = CGPoint(x: target.midX, y: target.maxY)
            case .bottom: attachmentPoint = CGPoint(x: target.midX, y: target.minY)
            }
        }
        shapeEdge = edge
        let started = CACurrentMediaTime()
        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        motionClock.tick = { [weak self] timestamp in
            guard let self, let panel = self.railPanel else { return }
            let elapsed = timestamp - started
            let complete = reduceMotion || elapsed >= 0.5
            let p: CGFloat = complete ? 1 : TimerMotionClock.settlingProgress(at: elapsed)
            func mix(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * p }
            self.horizontal = mix(startHorizontal, targetHorizontal)
            self.detachment = mix(startDetachment, targetDetachment)
            self.floatingFlip = mix(startFlip, targetFlip)
            self.present(
                CGRect(
                    x: mix(start.minX, target.minX), y: mix(start.minY, target.minY),
                    width: mix(start.width, target.width), height: mix(start.height, target.height)))
            if complete {
                self.stopSettling()
                panel.hasShadow = self.placement.edge == nil
                panel.invalidateShadow()
                self.updatePointer()
            }
        }
        if reduceMotion {
            motionClock.tick?(started + 1)
        } else if let view = panel.contentView {
            motionClock.start(in: view)
        }
    }

    func reposition() {
        guard isVisible, !isDragging, let screen = selectedScreen() else { return }
        stopSettling()
        lastVisibleFrame = screen.visibleFrame
        horizontal = placement.edge?.isHorizontal == false ? 0 : 1
        detachment = placement.edge == nil ? 1 : 0
        shapeEdge = placement.edge ?? placement.floatingOriginEdge ?? .right
        floatingFlip = shapeEdge == .right ? 1 : 0
        attachmentPoint = nil
        present(TimerSidebarLayout.frame(for: placement, in: screen.visibleFrame))
        railPanel?.hasShadow = placement.edge == nil
    }

    func refreshAfterWorkspaceChange() {
        guard isVisible else { return }
        reposition()
        railPanel?.orderFrontRegardless()
    }

    func moveToPointerDisplay() {
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) else { return }
        placement.displayID = screenIdentifier(screen)
        savePlacement()
        show()
    }

    func resetPosition() {
        placement = TimerSidebarPlacement(displayID: placement.displayID)
        savePlacement()
        show()
    }

    func showSettings() {
        if settingsWindow == nil {
            settingsWindow = makeWindow(
                title: "Timer Settings", size: CGSize(width: 860, height: 680),
                view: SettingsView().environment(model).environment(self).environment(focusModel).environment(focusAuth)
            )
            settingsWindow?.toolbarStyle = .unified
            settingsWindow?.styleMask.insert(.fullSizeContentView)
            settingsWindow?.titleVisibility = .hidden
            settingsWindow?.titlebarAppearsTransparent = true
            settingsWindow?.titlebarSeparatorStyle = .none
            settingsWindow?.appearance = NSAppearance(named: .darkAqua)
            settingsWindow?.isOpaque = false
            settingsWindow?.backgroundColor = .clear
        }
        NSApplication.shared.activate()
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    func showMainWindow() {
        if mainWindow == nil {
            mainWindow = makeWindow(
                title: "Timer", size: CGSize(width: 560, height: 480),
                view: TimerWindowView().environment(model).environment(self)
            )
        }
        NSApplication.shared.activate()
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    func showFocusWindow() {
        if focusWindow == nil {
            focusWindow = makeWindow(
                title: "Focus", size: CGSize(width: 680, height: 460),
                view: FocusWindowView().environment(model).environment(self).environment(focusModel).environment(
                    focusAuth)
            )
            focusWindow?.styleMask.insert(.fullSizeContentView)
            focusWindow?.titleVisibility = .hidden
            focusWindow?.titlebarAppearsTransparent = true
            focusWindow?.isOpaque = false
            focusWindow?.backgroundColor = .clear
            focusWindow?.isMovableByWindowBackground = true
            for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
                focusWindow?.standardWindowButton(button)?.isHidden = true
            }
        }
        NSApplication.shared.activate()
        focusWindow?.deminiaturize(nil)
        focusWindow?.makeKeyAndOrderFront(nil)
        Task {
            await prepareFocus()
            await focusAuth.resume()
            await focusModel.refresh()
        }
    }

    func quit() { NSApplication.shared.terminate(nil) }

    func shutdown() {
        stopWatchingPointer()
        stopSettling()
        for window in [railPanel, settingsWindow, mainWindow, focusWindow] {
            window?.orderOut(nil)
            window?.contentView = nil
        }
    }

    private func present(_ proposedFrame: CGRect) {
        guard let panel = railPanel else { return }
        let frame = CGRect(origin: proposedFrame.origin, size: geometry.size)
        bodyFrame = frame
        var canvas = frame
        let drawsBridge = detachment > 0 && detachment < 1 && attachmentPoint != nil
        if drawsBridge, let attachmentPoint {
            // Keep the wall contact at the original attachment footprint during
            // a perpendicular pull. Only movement along the wall slides it.
            let gap = attachmentGap(from: frame) ?? 0
            let radius = TimerLiquidShape.wallRadius(edge: shapeEdge, gap: gap)
            if radius > 0 {
                let anchorFrame = CGRect(
                    x: attachmentPoint.x - (shapeEdge.isHorizontal ? radius : 0),
                    y: attachmentPoint.y - (shapeEdge.isHorizontal ? 0 : radius),
                    width: shapeEdge.isHorizontal ? radius * 2 : 0,
                    height: shapeEdge.isHorizontal ? 0 : radius * 2)
                canvas = canvas.union(anchorFrame)
                bridgeAnchor = CGPoint(x: attachmentPoint.x - canvas.minX, y: canvas.maxY - attachmentPoint.y)
            } else {
                bridgeAnchor = nil
            }
        } else {
            bridgeAnchor = nil
        }
        bodyOrigin = CGPoint(x: frame.minX - canvas.minX, y: canvas.maxY - frame.maxY)
        panel.setFrame(canvas, display: false)
    }

    private func attachmentGap(from frame: CGRect) -> CGFloat? {
        guard let attachmentPoint else { return nil }
        switch shapeEdge {
        case .right: return attachmentPoint.x - frame.maxX
        case .left: return frame.minX - attachmentPoint.x
        case .top: return attachmentPoint.y - frame.maxY
        case .bottom: return frame.minY - attachmentPoint.y
        }
    }

    private func stopSettling() {
        motionClock.stop()
        motionClock.tick = nil
    }

    private func savePlacement() {
        if let data = try? JSONEncoder().encode(placement) {
            defaults.set(data, forKey: "sidebarPlacement")
        }
    }

    private func selectedScreen() -> NSScreen? {
        let screens = NSScreen.screens
        return screens.first(where: { screenIdentifier($0) == placement.displayID }) ?? screens.first
    }

    private func screenIdentifier(_ screen: NSScreen) -> String? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue
    }

    private func startWatchingPointer() {
        guard pointerTask == nil else { return }
        // Mouse-only monitors make transparent corners pass clicks through.
        let mask: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged]
        if let monitor = NSEvent.addGlobalMonitorForEvents(
            matching: mask,
            handler: { [weak self] _ in
                MainActor.assumeIsolated { self?.updatePointer() }
            })
        {
            mouseMonitors.append(monitor)
        }
        if let monitor = NSEvent.addLocalMonitorForEvents(
            matching: mask,
            handler: { [weak self] event in
                MainActor.assumeIsolated { self?.updatePointer() }
                return event
            })
        {
            mouseMonitors.append(monitor)
        }
        pointerTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                if let self, self.selectedScreen()?.visibleFrame != self.lastVisibleFrame { self.reposition() }
                self?.updatePointer()
            }
        }
        updatePointer()
    }

    private func stopWatchingPointer() {
        pointerTask?.cancel()
        pointerTask = nil
        mouseMonitors.forEach(NSEvent.removeMonitor)
        mouseMonitors.removeAll()
    }

    private func updatePointer() {
        guard isVisible, !isDragging, let railPanel else { return }
        let mouse = NSEvent.mouseLocation
        let point = CGPoint(x: mouse.x - bodyFrame.minX, y: bodyFrame.maxY - mouse.y)
        let path = TimerSidebarShape(edge: shapeEdge, detachment: detachment).path(
            in: CGRect(origin: .zero, size: bodyFrame.size))
        railPanel.ignoresMouseEvents = !path.contains(point)
    }

    private func makeWindow(title: String, size: CGSize, view: some View) -> NSWindow {
        let window = NSWindow(
            contentRect: CGRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
        )
        window.title = title
        window.isReleasedWhenClosed = false
        window.isRestorable = false
        window.contentView = NSHostingView(rootView: view)
        window.center()
        return window
    }
}
