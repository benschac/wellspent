import Foundation

/// Shared, continuous geometry for drawing, pointer anchoring, and window sizing.
public struct TimerSidebarGeometry {
    public var horizontal: CGFloat
    public var floatingFlip: CGFloat = 0
    public var detachment: CGFloat = 1

    public init(horizontal: CGFloat, floatingFlip: CGFloat = 0, detachment: CGFloat = 1) {
        self.horizontal = horizontal
        self.floatingFlip = floatingFlip
        self.detachment = detachment
    }

    public static func size(for edge: TimerSidebarEdge?) -> CGSize {
        Self(horizontal: edge?.isHorizontal == false ? 0 : 1, detachment: edge == nil ? 1 : 0).size
    }

    public static let contentInset: CGFloat = 16
    // Two 40-point curves meet across the 80-point body without a flat shelf.
    public static let shoulder: CGFloat = 40
    private var shoulderInset: CGFloat { Self.shoulder * horizontal * (1 - detachment) }

    public var size: CGSize {
        CGSize(width: mix(80, 244) + shoulderInset * 2, height: mix(205 + Self.shoulder * 2, 80))
    }
    public var ring: CGPoint { point(40, Self.shoulder + 40, 40 + 164 * floatingFlip, 40) }
    public var label: CGPoint { point(40, Self.shoulder + 100, 117 + 10 * floatingFlip, 40) }
    public var settings: CGPoint { point(40, Self.shoulder + 171, 210 - 176 * floatingFlip, 40) }
    public var divider: CGPoint { point(40, Self.shoulder + 136.5, 170.5 - 97 * floatingFlip, 40) }
    public var face: CGRect {
        CGRect(
            x: min(ring.x, label.x) - 32, y: min(ring.y, label.y) - 28,
            width: abs(ring.x - label.x) + 64, height: abs(ring.y - label.y) + 56)
    }
    public func mix(_ start: CGFloat, _ end: CGFloat) -> CGFloat {
        start + (end - start) * horizontal
    }
    private func point(_ x: CGFloat, _ y: CGFloat, _ endX: CGFloat, _ endY: CGFloat) -> CGPoint {
        CGPoint(x: mix(x, endX) + shoulderInset, y: mix(y, endY))
    }

    /// Translation uses AppKit screen coordinates (positive Y points up).
    public static func detachment(edge: TimerSidebarEdge, translation: CGPoint) -> CGFloat {
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

    /// Returns a frame in AppKit screen coordinates (positive Y points up).
    public func frame(holding point: CGPoint, offset: CGPoint, byRing: Bool) -> CGRect {
        let anchor = byRing ? ring : label
        return CGRect(
            x: point.x - anchor.x - offset.x,
            y: point.y - size.height + anchor.y + offset.y,
            width: size.width, height: size.height)
    }
}
