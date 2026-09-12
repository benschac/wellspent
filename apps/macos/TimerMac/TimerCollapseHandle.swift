import LiquidUI
import SwiftUI

struct TimerCollapseHandle: View {
    @Environment(TimerSidebarController.self) private var sidebar

    var body: some View {
        let handle = sidebar.geometry.handleGeometry
        let frame = handle.frame
        TimerCollapseSurface(sidebar: sidebar)
            .frame(width: frame.width, height: frame.height)
            .overlay {
                LiquidContourSurface(
                    size: frame.size,
                    path: handle.fillPath.offsetBy(dx: -frame.minX, dy: -frame.minY)
                ) { size, path, reduceTransparency in
                    TimerFrostedBackdrop(size: size, path: path, reduceTransparency: reduceTransparency)
                }
            }
            .help(sidebar.isCollapsed ? "Expand timer · drag down" : "Collapse to ring · drag up")
    }
}
