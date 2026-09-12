import LiquidUI
import SwiftUI

/// The macOS widget adds a bottom disclosure handle to the shared timer face.
struct TimerWidgetGeometry {
    static let collapseTravel: CGFloat = 117
    var horizontal: CGFloat
    var floatingFlip: CGFloat = 0
    var detachment: CGFloat = 1
    var collapse: CGFloat = 0
    var handleEdge: TimerSidebarEdge? = nil

    private var expanded: TimerSidebarGeometry {
        TimerSidebarGeometry(horizontal: horizontal, floatingFlip: floatingFlip, detachment: detachment)
    }
    private var progress: CGFloat { min(1, max(0, collapse)) }
    private var shoulderInset: CGFloat { TimerSidebarGeometry.shoulder * horizontal * (1 - detachment) }
    var size: CGSize {
        CGSize(
            width: expanded.size.width + (80 + shoulderInset * 2 - expanded.size.width) * progress,
            height: expanded.size.height - Self.collapseTravel * progress * (1 - horizontal))
    }
    var ring: CGPoint {
        CGPoint(x: expanded.ring.x + (40 + shoulderInset - expanded.ring.x) * progress, y: expanded.ring.y)
    }
    var label: CGPoint { folded(expanded.label) }
    var settings: CGPoint { folded(expanded.settings) }
    var divider: CGPoint { folded(expanded.divider) }
    var handleGeometry: TimerHandleGeometry {
        TimerHandleGeometry(size: size, edge: handleEdge, detachment: detachment)
    }
    var handle: CGPoint { CGPoint(x: handleFrame.midX, y: handleFrame.midY) }
    var handleFrame: CGRect { handleGeometry.frame }
    /// Reserve transparent window space around the external grip.
    func availableBodyArea(in screen: CGRect) -> CGRect {
        let below = max(0, handleFrame.maxY - size.height)
        let above = max(0, -handleFrame.minY)
        let left = max(0, -handleFrame.minX)
        let right = max(0, handleFrame.maxX - size.width)
        return CGRect(
            x: screen.minX + left, y: screen.minY + below,
            width: screen.width - left - right, height: screen.height - below - above)
    }
    var face: CGRect {
        CGRect(
            x: min(ring.x, label.x) - 32, y: min(ring.y, label.y) - 28,
            width: abs(ring.x - label.x) + 64, height: abs(ring.y - label.y) + 56)
    }
    var contentOpacity: Double { Double(max(0, 1 - progress * 2)) }
    func mix(_ start: CGFloat, _ end: CGFloat) -> CGFloat { expanded.mix(start, end) }
    private func folded(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x + (ring.x - point.x) * progress, y: point.y + (ring.y - point.y) * progress)
    }
    func frame(holding point: CGPoint, offset: CGPoint = .zero, byRing: Bool = true) -> CGRect {
        let anchor = byRing ? ring : label
        return CGRect(
            x: point.x - anchor.x - offset.x, y: point.y - size.height + anchor.y + offset.y,
            width: size.width, height: size.height)
    }
}
