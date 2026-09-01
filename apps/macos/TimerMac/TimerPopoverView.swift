import AppKit
import SwiftUI

struct TimerPopoverView: View {
    @Environment(TimerModel.self) private var model
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack {
            HStack {
                ConnectionStatusView(state: model.connectionState)

                Spacer()

                SettingsLink {
                    Label("Settings", systemImage: "gearshape")
                }
                .labelStyle(.iconOnly)
            }

            Divider()

            TimerReadoutView()
            DurationPickerView()
            TimerControlsView()

            if let errorMessage = model.errorMessage {
                ErrorBannerView(message: errorMessage)
            }

            Divider()

            HStack {
                Button(
                    "Open Timer Window",
                    systemImage: "macwindow",
                    action: openTimerWindow
                )

                Spacer()

                if let revision = model.latestRevision {
                    Text("Server revision \(revision)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Button("Quit Timer", action: quit)
                .buttonStyle(.plain)
        }
        .padding()
        .frame(minWidth: 320, idealWidth: 340)
    }

    private func quit() {
        NSApplication.shared.terminate(nil)
    }

    private func openTimerWindow() {
        openWindow(id: "main")
        NSApplication.shared.activate()
    }
}
