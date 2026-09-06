import SwiftUI

/// Interpolates presentation coordinates without changing the shared contour or
/// sending animation frames through React Native.
struct LiquidPresentation: View, Animatable {
    var bodyFrame: CGRect
    var detachment: CGFloat
    let edge: TimerSidebarEdge
    let containerSize: CGSize

    nonisolated var animatableData: AnimatablePair<CGRect.AnimatableData, CGFloat> {
        get { AnimatablePair(bodyFrame.animatableData, detachment) }
        set {
            bodyFrame.animatableData = newValue.first
            detachment = newValue.second
        }
    }

    private var anchor: CGPoint {
        switch edge {
        case .left: CGPoint(x: 0, y: bodyFrame.midY)
        case .right: CGPoint(x: containerSize.width, y: bodyFrame.midY)
        case .top: CGPoint(x: bodyFrame.midX, y: 0)
        case .bottom: CGPoint(x: bodyFrame.midX, y: containerSize.height)
        }
    }

    var body: some View {
        TimerLiquidSurface(
            bodyFrame: bodyFrame, anchor: anchor, edge: edge, detachment: detachment
        ) { _, path, reduceTransparency in
            if !reduceTransparency {
                path.fill(.ultraThinMaterial)
            }
        }
    }
}
