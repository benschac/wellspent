import Foundation

/// Clicks and drags are exclusive, even when the pointer returns to its origin.
struct TimerDragGesture {
    private(set) var origin: CGPoint?
    private(set) var didDrag = false

    mutating func begin(at point: CGPoint) {
        origin = point
        didDrag = false
    }

    mutating func shouldBeginDragging(at point: CGPoint) -> Bool {
        guard let origin, !didDrag else { return false }
        guard hypot(point.x - origin.x, point.y - origin.y) >= 4 else { return false }
        didDrag = true
        return true
    }

    mutating func end() -> Bool {
        let isClick = origin != nil && !didDrag
        origin = nil
        return isClick
    }
}
