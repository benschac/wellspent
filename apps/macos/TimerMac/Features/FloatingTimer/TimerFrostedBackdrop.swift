import SwiftUI

struct TimerFrostedBackdrop: NSViewRepresentable {
    let size: CGSize
    let path: Path
    let reduceTransparency: Bool

    func makeNSView(context: Context) -> TimerFrostedView { TimerFrostedView() }

    func updateNSView(_ view: TimerFrostedView, context: Context) {
        view.isHidden = reduceTransparency
        view.updateMask(size: size, path: path.cgPath)
    }
}
