import SwiftUI

@main
struct TimerMacApp: App {
    @NSApplicationDelegateAdaptor(TimerAppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            TimerMenuView()
                .environment(delegate.composition.model)
                .environment(delegate.composition.sidebar)
                .environment(delegate.composition.windows)
        } label: {
            Label(delegate.composition.model.menuBarTitle, systemImage: "timer")
                .accessibilityLabel(delegate.composition.model.accessibilityTimerLabel)
        }
        .menuBarExtraStyle(.menu)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings…", action: delegate.composition.windows.showSettings)
                    .keyboardShortcut(",", modifiers: .command)
            }
        }
    }
}
