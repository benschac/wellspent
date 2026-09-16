import SwiftUI

struct TimerWindowView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerSidebarController.self) private var sidebar
    @Environment(TimerWindowCoordinator.self) private var windows

    var body: some View {
        VStack(spacing: 0) {
            TimerWorkspaceNavigationView()
                .padding()
            Divider()
            ScrollView {
                VStack(spacing: 20) {
                    HStack {
                        Label("Timer", systemImage: "timer")
                            .font(.title2)
                            .bold()

                        Spacer()

                        ConnectionStatusView(state: model.syncStatus)
                    }

                    Text(model.backendProfileLabel)
                        .foregroundStyle(model.isProductionAPI ? .orange : .secondary)
                        .textSelection(.enabled)

                    Divider()

                    TimerReadoutView()
                    TimerControlsView()
                    if let controls = sidebar.recordingControls {
                        Text(controls.status).font(.footnote)
                        if let message = controls.errorMessage ?? controls.recording.errorMessage {
                            ErrorBannerView(message: message)
                        }
                        Button("Review local recording", action: windows.showRecordingWindow)
                        Text("Records foreground app names on this Mac. Codex activity requires a separate connection.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Text(model.saveStatus)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if let errorMessage = model.errorMessage {
                        ErrorBannerView(message: errorMessage)
                    }

                    if let shortcutError = windows.focusShortcutError {
                        Label(shortcutError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }

                    TimerWindowActionsView()

                    if let revision = model.latestRevision {
                        Text("Server revision \(revision)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding()
            }
        }
        .frame(minWidth: 520, minHeight: 500)
    }
}
