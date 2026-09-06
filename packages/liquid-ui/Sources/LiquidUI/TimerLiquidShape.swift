import SwiftUI

/// One contour for the native frost, tint, and rim. The bridge is part of the
/// body outline, so there is no internal edge or differently shaded join.
public struct TimerLiquidShape: Shape {
    public var bodyFrame: CGRect
    public var anchor: CGPoint?
    public var edge: TimerSidebarEdge
    public var detachment: CGFloat

    public init(bodyFrame: CGRect, anchor: CGPoint?, edge: TimerSidebarEdge, detachment: CGFloat) {
        self.bodyFrame = bodyFrame
        self.anchor = anchor
        self.edge = edge
        self.detachment = detachment
    }

    public func path(in rect: CGRect) -> Path {
        guard let anchor, detachment > 0, detachment < 1 else {
            return TimerSidebarShape(edge: edge, detachment: detachment).path(in: bodyFrame)
        }
        let depth = edge.isHorizontal ? bodyFrame.height : bodyFrame.width
        let length = edge.isHorizontal ? bodyFrame.width : bodyFrame.height
        let gap: CGFloat
        let transform: CGAffineTransform
        switch edge {
        case .right:
            gap = anchor.x - bodyFrame.maxX
            transform = .identity
        case .left:
            gap = bodyFrame.minX - anchor.x
            transform = CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: depth, ty: 0)
        case .top:
            gap = bodyFrame.minY - anchor.y
            transform = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: depth)
        case .bottom:
            gap = anchor.y - bodyFrame.maxY
            transform = CGAffineTransform(a: 0, b: 1, c: 1, d: 0, tx: 0, ty: 0)
        }
        guard gap > 0 else {
            return TimerSidebarShape(edge: edge, detachment: detachment).path(in: bodyFrame)
        }
        guard gap < Self.separationDistance + Self.retractionDistance else {
            return TimerSidebarShape(edge: edge, detachment: detachment).path(in: bodyFrame)
        }
        let localAnchor = CGPoint(x: anchor.x - bodyFrame.minX, y: anchor.y - bodyFrame.minY).applying(
            transform.inverted())
        return connectedPath(depth: depth, length: length, gap: gap, wallCenter: localAnchor.y)
            .applying(transform)
            .applying(CGAffineTransform(translationX: bodyFrame.minX, y: bodyFrame.minY))
    }

    // A short capillary-style release, independent of the longer controls morph.
    // These are presentation distances in points, not a physical fluid solver.
    public static let separationDistance: CGFloat = 28
    public static let retractionDistance: CGFloat = 18

    public static func wallRadius(edge: TimerSidebarEdge, gap: CGFloat) -> CGFloat {
        let size = TimerSidebarGeometry.size(for: edge)
        let originalRadius = (edge.isHorizontal ? size.width : size.height) / 2
        let tension = smoothstep(gap / separationDistance)
        let recoil = recoil(at: gap)
        return (originalRadius * (1 - tension) + 26 * tension) * (1 - recoil)
    }

    private func connectedPath(depth: CGFloat, length: CGFloat, gap: CGFloat, wallCenter: CGFloat)
        -> Path
    {
        let body = TimerSidebarShape(edge: .right, detachment: detachment)
        let center = length / 2
        let cornerProgress = min(1, detachment * 4)
        let corner =
            min(28, depth / 2, length / 4) * (1 - cornerProgress)
            + min(26, depth / 2, length / 2) * cornerProgress
        let availableRoot = center - corner * cornerProgress
        let pull = min(1, gap / Self.separationDistance)
        let tension = Self.smoothstep(pull)
        let recoil = Self.recoil(at: gap)
        let compactRoot = min(26, availableRoot)
        let bodyRoot =
            availableRoot * (1 - tension) + compactRoot * tension
            + (availableRoot - compactRoot) * recoil
        let wallRoot = Self.wallRadius(edge: edge, gap: gap)
        // Quadratic thinning is shallow for the first few points. It avoids
        // making a deep U-shaped slot in a gap only two or three points wide.
        let middle = depth + gap / 2
        let waistCenter = (center + wallCenter) / 2
        let neckRoom = min(
            bodyRoot - abs(waistCenter - center), wallRoot - abs(waistCenter - wallCenter))
        let neck = max(0, neckRoom) * (1 - pull * pull)
        let wall = depth + gap
        let shoulder = min(28, depth / 2, length / 4) * (1 - cornerProgress)
        let restingInset = shoulder + corner * cornerProgress
        let breadth = sin(pull * .pi / 2) * (1 - recoil)
        let inset = restingInset + (min(depth / 2, 56) - restingInset) * breadth
        var path = body.rightEdgePath(
            in: CGRect(x: 0, y: 0, width: depth, height: length), close: false,
            wallCorners: false, wallInset: inset)
        let lowerY = length - shoulder
        // Stretch the entire shoulder into the neck. Keeping a small rounded
        // corner followed by a straight side creates the narrow vertical slot.
        let k: CGFloat = 0.5522847498
        path.addCurve(
            to: CGPoint(x: depth, y: center + bodyRoot),
            control1: CGPoint(x: depth - inset * (1 - k), y: lowerY),
            control2: CGPoint(x: depth, y: center + bodyRoot + (lowerY - center - bodyRoot) * k))
        func finishBody(_ path: inout Path) {
            path.addCurve(
                to: CGPoint(x: depth - inset, y: shoulder),
                control1: CGPoint(x: depth, y: center - bodyRoot - (center - bodyRoot - shoulder) * k),
                control2: CGPoint(x: depth - inset * (1 - k), y: shoulder))
            path.closeSubpath()
        }
        if gap < Self.separationDistance {
            path.addCurve(
                to: CGPoint(x: middle, y: waistCenter + neck),
                control1: CGPoint(x: depth, y: waistCenter + neck),
                control2: CGPoint(x: middle - gap * 0.22, y: waistCenter + neck))
            path.addCurve(
                to: CGPoint(x: wall, y: wallCenter + wallRoot),
                control1: CGPoint(x: middle + gap * 0.22, y: waistCenter + neck),
                control2: CGPoint(x: wall - gap * 0.12, y: wallCenter + wallRoot))
            path.addLine(to: CGPoint(x: wall, y: wallCenter - wallRoot))
            path.addCurve(
                to: CGPoint(x: middle, y: waistCenter - neck),
                control1: CGPoint(x: wall - gap * 0.12, y: wallCenter - wallRoot),
                control2: CGPoint(x: middle + gap * 0.22, y: waistCenter - neck))
            path.addCurve(
                to: CGPoint(x: depth, y: center - bodyRoot),
                control1: CGPoint(x: middle - gap * 0.22, y: waistCenter - neck),
                control2: CGPoint(x: depth, y: waistCenter - neck))
            finishBody(&path)
        } else {
            let recoil = Self.recoil(at: gap)
            // Reach is based on the neck at the instant of separation. Continuing
            // to multiply by the growing gap makes the old honey-like tails.
            let reach = Self.separationDistance / 2 * (1 - recoil)
            let rounding = min(1, recoil * 4)
            let bodyTipCenter = waistCenter + (center - waistCenter) * recoil
            let tip = depth + reach
            let handle = reach * 0.44 * (1 - rounding)
            let tangent = bodyRoot * 0.45 * rounding
            path.addCurve(
                to: CGPoint(x: tip, y: bodyTipCenter),
                control1: CGPoint(x: depth, y: bodyTipCenter + tangent),
                control2: CGPoint(x: tip - handle, y: bodyTipCenter + tangent))
            path.addCurve(
                to: CGPoint(x: depth, y: center - bodyRoot),
                control1: CGPoint(x: tip - handle, y: bodyTipCenter - tangent),
                control2: CGPoint(x: depth, y: bodyTipCenter - tangent))
            finishBody(&path)

            let wallTip = wall - reach
            let wallTipCenter = waistCenter + (wallCenter - waistCenter) * recoil
            let wallHandle = reach * (0.24 + 0.31 * rounding)
            let wallTangent = wallRoot * 0.55 * rounding
            path.move(to: CGPoint(x: wall, y: wallCenter - wallRoot))
            path.addCurve(
                to: CGPoint(x: wallTip, y: wallTipCenter),
                control1: CGPoint(x: wall - wallHandle, y: wallCenter - wallRoot),
                control2: CGPoint(x: wallTip + handle, y: wallTipCenter - wallTangent))
            path.addCurve(
                to: CGPoint(x: wall, y: wallCenter + wallRoot),
                control1: CGPoint(x: wallTip + handle, y: wallTipCenter + wallTangent),
                control2: CGPoint(x: wall - wallHandle, y: wallCenter + wallRoot))
            path.closeSubpath()
        }
        return path
    }

    private static func recoil(at gap: CGFloat) -> CGFloat {
        let t = min(1, max(0, (gap - separationDistance) / retractionDistance))
        return 1 - pow(1 - t, 3)
    }

    private static func smoothstep(_ value: CGFloat) -> CGFloat {
        let t = min(1, max(0, value))
        return t * t * (3 - 2 * t)
    }
}
