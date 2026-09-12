import SwiftUI

/// The same platform backdrop, tint, and rim can fill any liquid contour.
public struct LiquidContourSurface<Backdrop: View>: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    private let size: CGSize
    private let path: Path
    private let backdrop: (CGSize, Path, Bool) -> Backdrop

    public init(
        size: CGSize, path: Path,
        @ViewBuilder backdrop: @escaping (CGSize, Path, Bool) -> Backdrop
    ) {
        self.size = size
        self.path = path
        self.backdrop = backdrop
    }

    public var body: some View {
        ZStack {
            backdrop(size, path, reduceTransparency)
            path.fill(reduceTransparency ? Color(white: 0.14) : .white.opacity(0.12))
            path.stroke(
                LinearGradient(
                    colors: [.white.opacity(0.3), .white.opacity(0.06), .white.opacity(0.16)],
                    startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 0.75
            )
            .clipShape(path)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
