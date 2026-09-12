import AppKit
import SwiftUI

/// Screen-coordinate tracking stays stable while the handle's window shrinks.
struct TimerCollapseSurface: NSViewRepresentable {
    let sidebar: TimerSidebarController

    func makeNSView(context: Context) -> TimerDragView { TimerDragView() }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: TimerDragView, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 0, height: proposal.height ?? 0)
    }

    func updateNSView(_ view: TimerDragView, context: Context) {
        let handle = sidebar.geometry.handleGeometry
        view.interactionPath = handle.hitPath.offsetBy(dx: -handle.frame.minX, dy: -handle.frame.minY).cgPath
        view.setAccessibilityLabel(sidebar.isCollapsed ? "Expand timer" : "Collapse timer to ring")
        view.setAccessibilityHelp("Click to toggle. Drag up to collapse or down to expand.")
        view.onPress = sidebar.holdPosition
        view.onClick = sidebar.toggleCollapsed
        view.onDragBegan = sidebar.beginResizing
        view.onDragChanged = sidebar.updateResize
        view.onDragEnded = sidebar.endResizing
    }
}
