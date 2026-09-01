import SwiftUI

@main
struct TimerMacApp: App {
    @State private var model = TimerModel()

    var body: some Scene {
        Window("Timer", id: "main") {
            TimerWindowView()
                .environment(model)
        }
        .defaultSize(width: 560, height: 480)
        .windowResizability(.contentMinSize)

        MenuBarExtra {
            TimerPopoverView()
                .environment(model)
        } label: {
            Label(model.menuBarTitle, systemImage: "timer")
                .accessibilityLabel(model.accessibilityTimerLabel)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environment(model)
        }
    }
}
