import SwiftUI

@main
struct TimerMacApp: App {
    @NSApplicationDelegateAdaptor(TimerAppDelegate.self) private var delegate

    var body: some Scene {
        Settings { EmptyView() }
            .commands {
                CommandMenu("Workspace") {
                    Button("Local Recordings…", action: delegate.composition.windows.showRecordingWindow)
                        .keyboardShortcut("r", modifiers: [.command, .shift])
                    Button("Open Focus", action: delegate.composition.windows.showFocusWindow)
                        .keyboardShortcut("f", modifiers: [.control, .option, .command])
                    Button("Open Timer", action: delegate.composition.windows.showMainWindow)
                }
                CommandGroup(replacing: .appSettings) {
                    Button("Settings…", action: delegate.composition.windows.showSettings)
                        .keyboardShortcut(",", modifiers: .command)
                }
            }
    }
}
