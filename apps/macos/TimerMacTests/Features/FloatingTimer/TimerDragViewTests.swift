import AppKit
import Testing

@testable import TimerMac

@MainActor
struct TimerDragViewTests {
    @Test func dragTracksEveryEventAndFinishesOnlyOnMouseUp() throws {
        let window = NSWindow(
            contentRect: CGRect(x: 0, y: 0, width: 80, height: 244), styleMask: .borderless, backing: .buffered,
            defer: false)
        let view = TimerDragView(frame: window.contentLayoutRect)
        window.contentView = view
        var began = 0
        var presses = 0
        var ended = 0
        var clicks = 0
        var updates: [CGPoint] = []
        view.onPress = { presses += 1 }
        view.onDragBegan = { _ in began += 1 }
        view.onDragEnded = { ended += 1 }
        view.onClick = { clicks += 1 }
        view.onDragChanged = { updates.append($0) }

        view.mouseDown(with: try event(.leftMouseDown, at: CGPoint(x: 20, y: 20), window: window))
        #expect(presses == 1)
        #expect(began == 0)
        view.mouseDragged(with: try event(.leftMouseDragged, at: CGPoint(x: 40, y: 20), window: window))
        #expect(began == 1)
        #expect(updates.count == 1)
        window.setFrameOrigin(CGPoint(x: 100, y: 50))
        view.mouseDragged(with: try event(.leftMouseDragged, at: CGPoint(x: 10, y: 20), window: window))
        #expect(updates.last == CGPoint(x: 110, y: 70))
        #expect(began == 1)
        #expect(ended == 0)
        #expect(clicks == 0)

        view.mouseUp(with: try event(.leftMouseUp, at: CGPoint(x: 40, y: 20), window: window))
        #expect(ended == 1)
        #expect(clicks == 0)
        view.mouseUp(with: try event(.leftMouseUp, at: CGPoint(x: 40, y: 20), window: window))
        #expect(ended == 1)
        #expect(clicks == 0)
    }

    @Test func draggingLockedWidgetNeitherMovesNorClicks() throws {
        let view = TimerDragView(frame: CGRect(x: 0, y: 0, width: 64, height: 111))
        view.isLocked = true
        var clicks = 0
        var began = 0
        view.onClick = { clicks += 1 }
        view.onDragBegan = { _ in began += 1 }
        view.mouseDown(with: try event(.leftMouseDown, at: .zero))
        view.mouseDragged(with: try event(.leftMouseDragged, at: CGPoint(x: 40, y: 20)))
        view.mouseUp(with: try event(.leftMouseUp, at: CGPoint(x: 40, y: 20)))
        #expect(clicks == 0)
        #expect(began == 0)
    }

    @Test func handleCursorFollowsItsHitPathAndClosesDuringDrag() throws {
        let previousCursor = NSCursor.current
        defer { previousCursor.set() }
        let window = NSWindow(
            contentRect: CGRect(x: 0, y: 0, width: 80, height: 80),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        defer { window.close() }
        let view = TimerDragView(frame: CGRect(x: 0, y: 0, width: 80, height: 80))
        window.contentView = view
        view.interactionPath = CGPath(rect: CGRect(x: 0, y: 0, width: 30, height: 30), transform: nil)
        view.updateTrackingAreas()
        #expect(
            view.trackingAreas.contains { $0.options.contains(.activeAlways) && $0.options.contains(.cursorUpdate) })
        let inside = CGPoint(x: 10, y: 70)
        view.mouseEntered(with: try event(.mouseMoved, at: inside, window: window))
        #expect(NSCursor.current == .openHand)
        view.mouseMoved(with: try event(.mouseMoved, at: CGPoint(x: 60, y: 20), window: window))
        #expect(NSCursor.current == .arrow)
        view.cursorUpdate(with: try event(.mouseMoved, at: inside, window: window))
        #expect(NSCursor.current == .openHand)
        view.mouseDown(with: try event(.leftMouseDown, at: inside, window: window))
        let dragged = CGPoint(x: 20, y: 70)
        view.mouseDragged(with: try event(.leftMouseDragged, at: dragged, window: window))
        #expect(NSCursor.current == .closedHand)
        view.cursorUpdate(with: try event(.mouseMoved, at: dragged, window: window))
        #expect(NSCursor.current == .closedHand)
        view.mouseUp(with: try event(.leftMouseUp, at: dragged, window: window))
        #expect(NSCursor.current == .openHand)
        view.mouseExited(with: try event(.mouseMoved, at: CGPoint(x: 100, y: 20), window: window))
        #expect(NSCursor.current == .arrow)
    }

    private func event(_ type: NSEvent.EventType, at point: CGPoint, window: NSWindow? = nil) throws -> NSEvent {
        try #require(
            NSEvent.mouseEvent(
                with: type, location: point, modifierFlags: [], timestamp: 0,
                windowNumber: window?.windowNumber ?? 0, context: nil, eventNumber: 0, clickCount: 1, pressure: 1
            ))
    }
}
