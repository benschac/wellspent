import AppKit
import Observation
import SwiftUI

/// Owns reusable app destinations; closing a window does not stop shared services.
@MainActor
@Observable
final class TimerWindowCoordinator {
    var focusShortcutError: String?
    @ObservationIgnored private let model: TimerModel
    @ObservationIgnored private let sidebar: TimerSidebarController
    @ObservationIgnored private let focusModel: FocusModel
    @ObservationIgnored private let focusAuth: FocusAuthModel
    @ObservationIgnored private let prepareFocusAction: @MainActor () async -> Void
    @ObservationIgnored private var focusRefreshTask: Task<Void, Never>?
    @ObservationIgnored private(set) var settingsWindow: NSWindow?
    @ObservationIgnored private(set) var mainWindow: NSWindow?
    @ObservationIgnored private(set) var focusWindow: NSWindow?

    init(
        model: TimerModel, sidebar: TimerSidebarController,
        focusModel: FocusModel, focusAuth: FocusAuthModel,
        prepareFocus: @escaping @MainActor () async -> Void
    ) {
        self.model = model
        self.sidebar = sidebar
        self.focusModel = focusModel
        self.focusAuth = focusAuth
        self.prepareFocusAction = prepareFocus
    }

    func prepareFocus() async { await prepareFocusAction() }

    func showSettings() {
        if settingsWindow == nil {
            settingsWindow = makeWindow(
                title: "Timer Settings", size: CGSize(width: 860, height: 680),
                view: SettingsView().environment(model).environment(sidebar).environment(self).environment(focusModel)
                    .environment(focusAuth)
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
                view: TimerWindowView().environment(model).environment(sidebar).environment(self)
            )
        }
        NSApplication.shared.activate()
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    func showFocusWindow() {
        if focusWindow == nil {
            focusWindow = makeWindow(
                title: "Focus", size: CGSize(width: 680, height: 460),
                view: FocusWindowView().environment(model).environment(sidebar).environment(self).environment(
                    focusModel
                ).environment(
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
        guard focusRefreshTask == nil else { return }
        focusRefreshTask = Task { [weak self] in
            guard let self else { return }
            defer { focusRefreshTask = nil }
            await prepareFocus()
            guard !Task.isCancelled else { return }
            await focusAuth.resume()
            guard !Task.isCancelled else { return }
            await focusModel.refresh()
        }
    }

    func quit() { NSApplication.shared.terminate(nil) }

    func shutdown() {
        focusRefreshTask?.cancel()
        for window in [settingsWindow, mainWindow, focusWindow] {
            window?.orderOut(nil)
            window?.contentView = nil
        }
        settingsWindow = nil
        mainWindow = nil
        focusWindow = nil
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
