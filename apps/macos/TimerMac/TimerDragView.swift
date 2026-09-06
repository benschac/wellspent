import AppKit

final class TimerDragView: NSView {
    var isLocked = false
    var onPress: (() -> Void)?
    var onClick: (() -> Void)?
    var onDragBegan: ((CGPoint) -> Void)?
    var onDragChanged: ((CGPoint) -> Void)?
    var onDragEnded: (() -> Void)?
    private var gesture = TimerDragGesture()
    private var mouseDownPoint: CGPoint?
    private var isWindowDragging = false

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
        bounds.contains(convert(point, from: superview)) ? self : nil
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
        addCursorRect(bounds, cursor: isLocked ? .arrow : .openHand)
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
