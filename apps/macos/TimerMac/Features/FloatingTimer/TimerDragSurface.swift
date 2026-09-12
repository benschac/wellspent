import AppKit
import SwiftUI

struct TimerDragSurface: NSViewRepresentable {
    let model: TimerModel
    let isLocked: Bool
    let onPress: () -> Void
    let onClick: () -> Void
    let onDragBegan: (CGPoint) -> Void
    let onDragChanged: (CGPoint) -> Void
    let onDragEnded: () -> Void

    func makeNSView(context: Context) -> TimerDragView { TimerDragView() }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: TimerDragView, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 0, height: proposal.height ?? 0)
    }

    func updateNSView(_ view: TimerDragView, context: Context) {
        let label = "Timer, \(model.accessibilityTimerLabel)"
        let help = isLocked ? "Click to start or pause. Position locked." : "Click to start or pause. Drag to move."
        if view.accessibilityLabel() != label { view.setAccessibilityLabel(label) }
        if view.accessibilityHelp() != help { view.setAccessibilityHelp(help) }
        if view.isLocked != isLocked {
            view.isLocked = isLocked
            view.window?.invalidateCursorRects(for: view)
        }
        view.onPress = onPress
        view.onClick = onClick
        view.onDragBegan = onDragBegan
        view.onDragChanged = onDragChanged
        view.onDragEnded = onDragEnded
    }
}
