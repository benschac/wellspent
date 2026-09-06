import SwiftUI

/// Desktop blur, tint, and rim share a single liquid contour. No black shader
/// overlay or body-only border can reveal a seam across the connecting neck.
struct TimerSidebarSurface: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let bodyFrame: CGRect
    let anchor: CGPoint?
    let edge: TimerSidebarEdge
    let detachment: CGFloat

    var body: some View {
        GeometryReader { geometry in
            let shape = TimerLiquidShape(bodyFrame: bodyFrame, anchor: anchor, edge: edge, detachment: detachment)
            let path = shape.path(in: CGRect(origin: .zero, size: geometry.size))
            ZStack {
                TimerFrostedBackdrop(size: geometry.size, path: path, reduceTransparency: reduceTransparency)
                path.fill(reduceTransparency ? Color(white: 0.14) : .white.opacity(0.12))
                path.stroke(
                    LinearGradient(
                        colors: [.white.opacity(0.3), .white.opacity(0.06), .white.opacity(0.16)],
                        startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 0.75
                )
                .clipShape(shape)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
