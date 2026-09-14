import SwiftUI

struct LocalHarnessView: View {
    @Environment(RecordingModel.self) private var recording
    @State private var approvingConnection = false

    var body: some View {
        let harness = recording.harness
        GroupBox("AI Harness") {
            VStack(alignment: .leading, spacing: 8) {
                Text(harness.status)
                    .foregroundStyle(harness.hasError ? .red : .primary)
                    .accessibilityIdentifier("harness-status")
                Text(harness.recordingStatus).font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button(harness.isConnected ? "Reconnect Codex…" : "Connect Codex…") {
                        approvingConnection = true
                    }
                    .disabled(harness.isBusy)
                    .accessibilityIdentifier("connect-codex")
                    if harness.isConnected || harness.hasError {
                        Button("Disconnect", role: .destructive) { harness.disconnect() }
                            .disabled(harness.isBusy)
                            .accessibilityIdentifier("disconnect-codex")
                    }
                    if harness.isBusy { ProgressView().controlSize(.small).accessibilityLabel("Updating connection") }
                }
                Text(
                    "Only notes explicitly submitted with log_work are saved. Automatic metadata hooks are configured separately below."
                )
                .font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .confirmationDialog("Connect Codex to Wellspent?", isPresented: $approvingConnection, titleVisibility: .visible)
        {
            Button("Connect Codex") { harness.connect() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "This adds the local wellspent-local MCP server to your Codex configuration. Node and the Codex CLI must be installed. Explicit log_work text stays on this Mac and requires an active recording interval. This does not enable automatic hooks or transcript access. Credentials stay in private local storage. Open a new Codex session after connecting."
            )
        }
    }
}
