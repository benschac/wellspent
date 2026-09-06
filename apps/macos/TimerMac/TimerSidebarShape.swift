import SwiftUI

/// Rounded shoulders turn back toward the display edge at both ends.
struct TimerSidebarShape: Shape {
    var edge: TimerSidebarEdge? = .right
    var detachment: CGFloat = 0

    var animatableData: CGFloat {
        get { detachment }
        set { detachment = newValue }
    }

    // Retract the attachment shoulders early; keeping them for the entire
    // layout morph leaves tabs above and below an already-floating body.
    private var roundness: CGFloat { min(1, max(0, detachment * 4)) }

    func path(in rect: CGRect) -> Path {
        guard let edge, roundness < 1 else { return Path(roundedRect: rect, cornerRadius: 26) }
        let depth = edge.isHorizontal ? rect.height : rect.width
        let length = edge.isHorizontal ? rect.width : rect.height
        let canonical = rightEdgePath(in: CGRect(x: 0, y: 0, width: depth, height: length))
        let transform: CGAffineTransform
        switch edge {
        case .right: transform = .identity
        case .left: transform = CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: depth, ty: 0)
        case .top: transform = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: depth)
        case .bottom: transform = CGAffineTransform(a: 0, b: 1, c: 1, d: 0, tx: 0, ty: 0)
        }
        return canonical.applying(transform).applying(
            CGAffineTransform(translationX: rect.minX, y: rect.minY)
        )
    }

    func rightEdgePath(in rect: CGRect, close: Bool = true, wallCorners: Bool = true, wallInset: CGFloat? = nil) -> Path
    {
        let progress = roundness
        let shoulder: CGFloat = min(28, rect.width / 2, rect.height / 4) * (1 - progress)
        let corner: CGFloat =
            min(28, rect.width / 2, rect.height / 4) * (1 - progress)
            + min(26, rect.width / 2, rect.height / 2) * progress
        let endRadius = corner * progress
        var path = Path()
        // Begin with the existing quadratic shoulders and converge on circular
        // capsule corners, using the same cubic topology throughout the pull.
        let controlScale = (2.0 / 3.0) * (1 - progress) + 0.5522847498 * progress
        func addCorner(to end: CGPoint, control: CGPoint) {
            let start = path.currentPoint ?? .zero
            path.addCurve(
                to: end,
                control1: CGPoint(
                    x: start.x + (control.x - start.x) * controlScale,
                    y: start.y + (control.y - start.y) * controlScale),
                control2: CGPoint(
                    x: end.x + (control.x - end.x) * controlScale,
                    y: end.y + (control.y - end.y) * controlScale))
        }
        if wallCorners {
            path.move(to: CGPoint(x: rect.maxX, y: rect.minY + endRadius))
            addCorner(
                to: CGPoint(x: rect.maxX - shoulder - endRadius, y: rect.minY + shoulder),
                control: CGPoint(x: rect.maxX, y: rect.minY + shoulder))
        } else {
            path.move(to: CGPoint(x: rect.maxX - (wallInset ?? (shoulder + endRadius)), y: rect.minY + shoulder))
        }
        path.addLine(to: CGPoint(x: rect.minX + corner, y: rect.minY + shoulder))
        addCorner(
            to: CGPoint(x: rect.minX, y: rect.minY + shoulder + corner),
            control: CGPoint(x: rect.minX, y: rect.minY + shoulder)
        )
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - shoulder - corner))
        addCorner(
            to: CGPoint(x: rect.minX + corner, y: rect.maxY - shoulder),
            control: CGPoint(x: rect.minX, y: rect.maxY - shoulder)
        )
        path.addLine(to: CGPoint(x: rect.maxX - (wallInset ?? (shoulder + endRadius)), y: rect.maxY - shoulder))
        if wallCorners {
            addCorner(
                to: CGPoint(x: rect.maxX, y: rect.maxY - endRadius),
                control: CGPoint(x: rect.maxX, y: rect.maxY - shoulder))
        }
        if close { path.closeSubpath() }
        return path
    }
}
