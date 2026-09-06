import SwiftUI

struct TimerSidebarView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerSidebarController.self) private var sidebar

    var body: some View {
        let geometry = sidebar.geometry
        let shape = TimerSidebarShape(edge: sidebar.shapeEdge, detachment: sidebar.detachment)
        ZStack(alignment: .topLeading) {
            TimerSidebarSurface(
                bodyFrame: CGRect(origin: sidebar.bodyOrigin, size: geometry.size),
                anchor: sidebar.bridgeAnchor, edge: sidebar.shapeEdge,
                detachment: sidebar.detachment)
            ZStack(alignment: .topLeading) {
                TimerDragSurface(
                    model: model,
                    isLocked: sidebar.isPositionLocked,
                    onPress: sidebar.holdPosition,
                    onClick: sidebar.clickTimer,
                    onDragBegan: sidebar.beginDragging,
                    onDragChanged: sidebar.updateDrag,
                    onDragEnded: sidebar.endDragging
                )
                .frame(width: geometry.face.width, height: geometry.face.height)
                .position(x: geometry.face.midX, y: geometry.face.midY)

                TimerCompactFace(geometry: geometry)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)

                Rectangle()
                    .fill(.white.opacity(0.16))
                    .frame(width: geometry.mix(24, 1), height: geometry.mix(1, 24))
                    .position(geometry.divider)
                    .allowsHitTesting(false)

                Button("Settings", systemImage: "gearshape", action: sidebar.showSettings)
                    .labelStyle(.iconOnly)
                    .font(.system(size: 15))
                    .frame(width: 36, height: 36)
                    .background(.white.opacity(0.08), in: Circle())
                    .buttonStyle(.plain)
                    .help("Timer settings")
                    .position(geometry.settings)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .contentShape(shape)
            .offset(x: sidebar.bodyOrigin.x, y: sidebar.bodyOrigin.y)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .foregroundStyle(.white)
        // The display link supplies presentation geometry, including the release
        // spring. A second implicit animation would make the label lag the hand.
        .transaction { $0.animation = nil }
        .preferredColorScheme(.dark)
        .contextMenu {
            Button("Open Timer Window", action: sidebar.showMainWindow)
            Button("Settings…", action: sidebar.showSettings)
            Button(sidebar.isPositionLocked ? "Unlock Position" : "Lock Position") {
                sidebar.isPositionLocked.toggle()
            }
            Divider()
            Button("Reset Position", action: sidebar.resetPosition)
            Button("Hide Sidebar", action: sidebar.hide)
            Button("Quit Timer", action: sidebar.quit)
        }
    }
}
