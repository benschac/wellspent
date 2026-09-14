import SwiftUI

struct TimerWindowActionsView: View {
    @Environment(TimerWindowCoordinator.self) private var windows
    @Environment(TimerSidebarController.self) private var sidebar

    var body: some View {
        VStack(spacing: 12) {
            GroupBox("Floating timer") {
                HStack {
                    Button(
                        sidebar.isVisible ? "Hide Floating Timer" : "Show Floating Timer",
                        systemImage: sidebar.isVisible ? "eye.slash" : "eye",
                        action: sidebar.toggleVisibility
                    )
                    Button("Move Floating Timer Here", systemImage: "display", action: sidebar.moveToPointerDisplay)
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack {
                Spacer()
                Button("Quit Timer", systemImage: "power", role: .destructive, action: windows.quit)
                    .keyboardShortcut("q", modifiers: .command)
            }
        }
    }
}
