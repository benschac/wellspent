import AppKit

final class TimerDragView: NSView {
    var interactionPath: CGPath?
    var isLocked = false
    var onPress: (() -> Void)?
    var onClick: (() -> Void)?
    var onDragBegan: ((CGPoint) -> Void)?
    var onDragChanged: ((CGPoint) -> Void)?
    var onDragEnded: (() -> Void)?
    private var gesture = TimerDragGesture()
    private var mouseDownPoint: CGPoint?
    private var isWindowDragging = false
    private var cursorTrackingArea: NSTrackingArea?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityChildren([])
    }

    required init?(coder: NSCoder) { nil }

    isolated deinit {
        if isWindowDragging { NSCursor.pop() }
    }

    // This native view owns the gesture from mouse-down through mouse-up.
    // Its SwiftUI label is visual content, not a competing Button recognizer.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        return containsInteractionPoint(local) ? self : nil
    }

    override var acceptsFirstResponder: Bool { true }

    override func accessibilityPerformPress() -> Bool {
        onClick?()
        return true
    }

    override func keyDown(with event: NSEvent) {
        if event.charactersIgnoringModifiers == " " || event.charactersIgnoringModifiers == "\r" {
            onClick?()
        } else {
            super.keyDown(with: event)
        }
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func resetCursorRects() {
        // The curved handle uses tracking below, so its transparent corners
        // don't advertise a grab cursor outside the actual hit area.
        if interactionPath == nil {
            addCursorRect(bounds, cursor: isLocked ? .arrow : .openHand)
        }
    }

    override func updateTrackingAreas() {
        if let cursorTrackingArea { removeTrackingArea(cursorTrackingArea) }
        super.updateTrackingAreas()
        let area = NSTrackingArea(
            rect: .zero,
            options: [.activeAlways, .inVisibleRect, .cursorUpdate, .mouseEnteredAndExited, .mouseMoved],
            owner: self, userInfo: nil)
        addTrackingArea(area)
        cursorTrackingArea = area
    }

    override func cursorUpdate(with event: NSEvent) { updateCursor(with: event) }
    override func mouseEntered(with event: NSEvent) { updateCursor(with: event) }
    override func mouseMoved(with event: NSEvent) { updateCursor(with: event) }
    override func mouseExited(with event: NSEvent) {
        if !isWindowDragging { NSCursor.arrow.set() }
    }

    private func updateCursor(with event: NSEvent) {
        if isWindowDragging {
            NSCursor.closedHand.set()
        } else {
            let local = convert(event.locationInWindow, from: nil)
            let cursor: NSCursor = !isLocked && containsInteractionPoint(local) ? .openHand : .arrow
            cursor.set()
        }
    }

    private func containsInteractionPoint(_ local: CGPoint) -> Bool {
        guard bounds.contains(local) else { return false }
        // SwiftUI supplies the disclosure path in top-down coordinates.
        let point = CGPoint(x: local.x, y: isFlipped ? local.y : bounds.height - local.y)
        return interactionPath?.contains(point) ?? true
    }

    private func screenPoint(for event: NSEvent) -> CGPoint {
        window?.convertPoint(toScreen: event.locationInWindow) ?? event.locationInWindow
    }

    override func mouseDown(with event: NSEvent) {
        if !isLocked { onPress?() }
        let point = screenPoint(for: event)
        mouseDownPoint = point
        gesture.begin(at: point)
    }

    override func mouseDragged(with event: NSEvent) {
        let point = screenPoint(for: event)
        if !isWindowDragging {
            guard gesture.shouldBeginDragging(at: point) else { return }
            // Crossing the threshold suppresses clicks even when position is locked.
            guard !isLocked, let mouseDownPoint else { return }
            isWindowDragging = true
            NSCursor.closedHand.push()
            onDragBegan?(mouseDownPoint)
        }
        // AppKit retains this mouse-down receiver while its frame morphs. Screen
        // coordinates prevent window resizing from feeding back into pointer deltas.
        onDragChanged?(point)
    }

    override func mouseUp(with event: NSEvent) {
        if isWindowDragging {
            onDragChanged?(screenPoint(for: event))
            finishDragging()
        } else {
            if gesture.end() { onClick?() }
            mouseDownPoint = nil
        }
        updateCursor(with: event)
    }

    private func finishDragging() {
        guard isWindowDragging else { return }
        isWindowDragging = false
        NSCursor.pop()
        _ = gesture.end()
        mouseDownPoint = nil
        onDragEnded?()
    }
}
