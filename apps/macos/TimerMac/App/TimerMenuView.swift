import SwiftUI

struct TimerMenuView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerWindowCoordinator.self) private var windows
    @Environment(TimerSidebarController.self) private var sidebar

    var body: some View {
        Text(model.backendProfileLabel)
        Text("Sync: \(model.syncStatus.label)")
        Text(model.saveStatus)
        Divider()
        Button("Open Focus", action: windows.showFocusWindow)
            .keyboardShortcut("f", modifiers: [.control, .option, .command])
        if let error = windows.focusShortcutError { Text(error) }
        Button(model.isRunning ? "Pause Timer" : "Start / Resume Timer", action: sidebar.toggleTimer)
        Button("Open Timer Window", action: windows.showMainWindow)
        Button("Settings…", action: windows.showSettings)
            .keyboardShortcut(",", modifiers: .command)
        Divider()
        Button(sidebar.isVisible ? "Hide Floating Timer" : "Show Floating Timer", action: sidebar.toggleVisibility)
        Button("Move to This Display", action: sidebar.moveToPointerDisplay)
        Divider()
        Button("Quit Timer", action: windows.quit)
            .keyboardShortcut("q", modifiers: .command)
    }
}
