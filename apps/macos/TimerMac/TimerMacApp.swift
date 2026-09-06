import SwiftUI

@main
struct TimerMacApp: App {
    @NSApplicationDelegateAdaptor(TimerAppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            TimerMenuView()
                .environment(delegate.model)
                .environment(delegate.sidebar)
        } label: {
            Label(delegate.model.menuBarTitle, systemImage: "timer")
                .accessibilityLabel(delegate.model.accessibilityTimerLabel)
        }
        .menuBarExtraStyle(.menu)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…", action: delegate.sidebar.showSettings)
                    .keyboardShortcut(",", modifiers: .command)
            }
        }
    }
}
