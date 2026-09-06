import SwiftUI

/// One contour for the platform backdrop, tint, and rim, including the neck.
/// The host supplies its native blur without putting AppKit or Expo in this library.
public struct TimerLiquidSurface<Backdrop: View>: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    private let bodyFrame: CGRect
    private let anchor: CGPoint?
    private let edge: TimerSidebarEdge
    private let detachment: CGFloat
    private let backdrop: (CGSize, Path, Bool) -> Backdrop

    public init(
        bodyFrame: CGRect, anchor: CGPoint?, edge: TimerSidebarEdge, detachment: CGFloat,
        @ViewBuilder backdrop: @escaping (CGSize, Path, Bool) -> Backdrop
    ) {
        self.bodyFrame = bodyFrame
        self.anchor = anchor
        self.edge = edge
        self.detachment = detachment
        self.backdrop = backdrop
    }

    public var body: some View {
        GeometryReader { geometry in
            let shape = TimerLiquidShape(
                bodyFrame: bodyFrame, anchor: anchor, edge: edge, detachment: detachment)
            let path = shape.path(in: CGRect(origin: .zero, size: geometry.size))
            ZStack {
                backdrop(geometry.size, path, reduceTransparency)
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
