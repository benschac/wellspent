import LiquidUI
import SwiftUI

/// Desktop blur, tint, and rim share a single liquid contour. No black shader
/// overlay or body-only border can reveal a seam across the connecting neck.
struct TimerSidebarSurface: View {
    let bodyFrame: CGRect
    let anchor: CGPoint?
    let edge: TimerSidebarEdge
    let detachment: CGFloat

    var body: some View {
        TimerLiquidSurface(bodyFrame: bodyFrame, anchor: anchor, edge: edge, detachment: detachment) {
            size, path, reduceTransparency in
            TimerFrostedBackdrop(size: size, path: path, reduceTransparency: reduceTransparency)
        }
    }
}
