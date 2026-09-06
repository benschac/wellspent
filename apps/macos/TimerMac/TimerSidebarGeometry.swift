import Foundation

/// Shared, continuous geometry for drawing, pointer anchoring, and window sizing.
struct TimerSidebarGeometry {
    var horizontal: CGFloat
    var floatingFlip: CGFloat = 0
    var detachment: CGFloat = 1

    static let contentInset: CGFloat = 16
    static let shoulder: CGFloat = 28
    private var shoulderInset: CGFloat { Self.shoulder * horizontal * (1 - detachment) }

    var size: CGSize { CGSize(width: mix(80, 244) + shoulderInset * 2, height: mix(261, 80)) }
    var ring: CGPoint { point(40, 68, 40 + 164 * floatingFlip, 40) }
    var label: CGPoint { point(40, 128, 117 + 10 * floatingFlip, 40) }
    var settings: CGPoint { point(40, 199, 210 - 176 * floatingFlip, 40) }
    var divider: CGPoint { point(40, 164.5, 170.5 - 97 * floatingFlip, 40) }
    var face: CGRect {
        CGRect(
            x: min(ring.x, label.x) - 32, y: min(ring.y, label.y) - 28,
            width: abs(ring.x - label.x) + 64, height: abs(ring.y - label.y) + 56)
    }
    func mix(_ start: CGFloat, _ end: CGFloat) -> CGFloat { start + (end - start) * horizontal }
    private func point(_ x: CGFloat, _ y: CGFloat, _ endX: CGFloat, _ endY: CGFloat) -> CGPoint {
        CGPoint(x: mix(x, endX) + shoulderInset, y: mix(y, endY))
    }

    static func detachment(edge: TimerSidebarEdge, translation: CGPoint) -> CGFloat {
        let distance: CGFloat
        switch edge {
        case .right: distance = -translation.x
        case .left: distance = translation.x
        case .top: distance = -translation.y
        case .bottom: distance = translation.y
        }
        // Direct manipulation is proportional to the hand from the first point.
        // Easing belongs to the release, not between the pointer and the shape.
        let t = min(1, max(0, distance / 140))
        return t
    }

    func frame(holding point: CGPoint, offset: CGPoint, byRing: Bool) -> CGRect {
        let anchor = byRing ? ring : label
        return CGRect(
            x: point.x - anchor.x - offset.x,
            y: point.y - size.height + anchor.y + offset.y,
            width: size.width, height: size.height)
    }
}
