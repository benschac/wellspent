import LiquidUI
import SwiftUI

/// An offset of the liquid shoulder itself, rather than a separate chevron.
struct TimerHandleGeometry {
    static let lineWidth: CGFloat = 4
    static let clearance: CGFloat = 10
    static let hitWidth: CGFloat = 20
    let size: CGSize
    let edge: TimerSidebarEdge?
    let detachment: CGFloat

    var path: Path {
        let edge = edge ?? .right
        let depth = edge.isHorizontal ? size.height : size.width
        let length = edge.isHorizontal ? size.width : size.height
        let progress = min(1, max(0, detachment * 4))
        let radius = min(TimerSidebarGeometry.shoulder, depth / 2, length / 4)
        let shoulder = radius * (1 - progress)
        let corner = radius * (1 - progress) + min(26, depth / 2, length / 2) * progress
        let endRadius = corner * progress
        let scale = (2.0 / 3.0) * (1 - progress) + 0.5522847498 * progress
        let start = CGPoint(x: depth - shoulder - endRadius, y: length - shoulder)
        let end = CGPoint(x: depth, y: length - endRadius)
        let control = CGPoint(x: depth, y: length - shoulder)
        let first = CGPoint(x: start.x + (control.x - start.x) * scale, y: start.y)
        let second = CGPoint(x: end.x, y: end.y + (control.y - end.y) * scale)
        var path = Path()
        // Sample the shoulder's cubic and offset along its outward normal.
        // Keep the visible stroke a constant 10 pt from the container.
        for step in 0...48 {
            let t = CGFloat(step) / 48
            let u = 1 - t
            let point = CGPoint(
                x: u * u * u * start.x + 3 * u * u * t * first.x + 3 * u * t * t * second.x + t * t * t * end.x,
                y: u * u * u * start.y + 3 * u * u * t * first.y + 3 * u * t * t * second.y + t * t * t * end.y)
            let tangent = CGPoint(
                x: 3 * u * u * (first.x - start.x) + 6 * u * t * (second.x - first.x) + 3 * t * t * (end.x - second.x),
                y: 3 * u * u * (first.y - start.y) + 6 * u * t * (second.y - first.y) + 3 * t * t * (end.y - second.y))
            let magnitude = max(0.001, hypot(tangent.x, tangent.y))
            let offset = Self.clearance + Self.lineWidth / 2
            let outside = CGPoint(
                x: point.x - tangent.y / magnitude * offset,
                y: point.y + tangent.x / magnitude * offset)
            if step == 0 { path.move(to: outside) } else { path.addLine(to: outside) }
        }
        let transform: CGAffineTransform
        switch edge {
        case .right: transform = .identity
        case .left: transform = CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: depth, ty: 0)
        case .top: transform = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: depth)
        case .bottom: transform = CGAffineTransform(a: 0, b: 1, c: 1, d: 0, tx: 0, ty: 0)
        }
        // Slide the same two-thirds-length grip around the groove, about 5 pt lower.
        return path.trimmedPath(from: 0.2, to: 0.2 + 2.0 / 3.0).applying(transform)
    }
    var fillPath: Path {
        path.strokedPath(StrokeStyle(lineWidth: Self.lineWidth, lineCap: .round, lineJoin: .round))
    }
    var hitPath: Path {
        path.strokedPath(StrokeStyle(lineWidth: Self.hitWidth, lineCap: .round, lineJoin: .round))
    }
    var frame: CGRect { hitPath.boundingRect }
}
