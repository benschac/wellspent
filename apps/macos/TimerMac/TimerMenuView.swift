import SwiftUI

struct TimerMenuView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerSidebarController.self) private var sidebar

    var body: some View {
        Text(model.backendProfileLabel)
        Text("Sync: \(model.syncStatus.label)")
        Text(model.saveStatus)
        Divider()
        Button(model.isRunning ? "Pause Timer" : "Start / Resume Timer", action: sidebar.toggleTimer)
        Button("Open Timer Window", action: sidebar.showMainWindow)
        Button("Settings…", action: sidebar.showSettings)
            .keyboardShortcut(",", modifiers: .command)
        Divider()
        Button(sidebar.isVisible ? "Hide Floating Timer" : "Show Floating Timer", action: sidebar.toggleVisibility)
        Button("Move to This Display", action: sidebar.moveToPointerDisplay)
        Divider()
        Button("Quit Timer", action: sidebar.quit)
            .keyboardShortcut("q", modifiers: .command)
    }
}
