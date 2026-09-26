import SwiftUI

struct TimerWindowActionsView: View {
    @Environment(TimerWindowCoordinator.self) private var windows
    @Environment(TimerSidebarController.self) private var sidebar
    @Environment(TimerModel.self) private var model

    var body: some View {
        Menu("Window options", systemImage: "ellipsis.circle") {
            Button("Settings…", systemImage: "gearshape", action: windows.showSettings)
            Button("Open Focus", systemImage: "scope", action: windows.showFocusWindow)
            Divider()
            Button(
                sidebar.isVisible ? "Hide Floating Timer" : "Show Floating Timer",
                systemImage: sidebar.isVisible ? "eye.slash" : "eye",
                action: sidebar.toggleVisibility)
            Button("Move Floating Timer Here", systemImage: "display", action: sidebar.moveToPointerDisplay)
            Divider()
            Text(model.backendProfileLabel)
            if let revision = model.latestRevision { Text("Server revision \(revision)") }
            Divider()
            Button("Quit Timer", systemImage: "power", role: .destructive, action: windows.quit)
        }
        .labelStyle(.iconOnly)
        .menuStyle(.borderlessButton)
        .fixedSize()
        .font(.title2)
        .help("Settings, Focus, and floating timer controls")
    }
}
