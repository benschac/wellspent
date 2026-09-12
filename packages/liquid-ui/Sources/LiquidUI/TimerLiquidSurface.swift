import SwiftUI

/// One contour for the platform backdrop, tint, and rim, including the neck.
/// The host supplies its native blur without putting AppKit or Expo in this library.
public struct TimerLiquidSurface<Backdrop: View>: View {
    private let bodyFrame: CGRect
    private let anchor: CGPoint?
    private let edge: TimerSidebarEdge
    private let detachment: CGFloat
    private let attachmentLength: CGFloat?
    private let backdrop: (CGSize, Path, Bool) -> Backdrop

    public init(
        bodyFrame: CGRect, anchor: CGPoint?, edge: TimerSidebarEdge, detachment: CGFloat,
        attachmentLength: CGFloat? = nil,
        @ViewBuilder backdrop: @escaping (CGSize, Path, Bool) -> Backdrop
    ) {
        self.bodyFrame = bodyFrame
        self.anchor = anchor
        self.edge = edge
        self.detachment = detachment
        self.attachmentLength = attachmentLength
        self.backdrop = backdrop
    }

    public var body: some View {
        GeometryReader { geometry in
            let shape = TimerLiquidShape(
                bodyFrame: bodyFrame, anchor: anchor, edge: edge, detachment: detachment,
                attachmentLength: attachmentLength)
            let path = shape.path(in: CGRect(origin: .zero, size: geometry.size))
            LiquidContourSurface(size: geometry.size, path: path, backdrop: backdrop)
        }
    }
}
