import SwiftUI

struct LocalCodexTelemetryView: View {
    @Environment(RecordingModel.self) private var recording

    var body: some View {
        @Bindable var telemetry = recording.telemetry
        DisclosureGroup("Advanced diagnostics — selected Codex source") {
            GroupBox("Selected Codex telemetry") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(telemetry.selectedSourceStatus).font(.callout)
                        .accessibilityIdentifier("codex-telemetry-source-status")
                    Text(
                        "Select one Codex 0.157.1 source for the active recording interval. Start at its exact current EOF; no history is imported. Run bun run dev:harness in the repository first."
                    )
                    .font(.caption).foregroundStyle(.secondary)
                    TextField("Exact absolute source path", text: $telemetry.filePath)
                    HStack {
                        TextField("Codex thread ID", text: $telemetry.threadID)
                        TextField("Codex session ID", text: $telemetry.sessionID)
                    }
                    HStack {
                        TextField("Current EOF (bytes)", text: $telemetry.eofOffset)
                        TextField("Helper port", value: $telemetry.port, format: .number.grouping(.never))
                            .frame(width: 110)
                    }
                    Text(
                        "Authorize up to 3 minutes and 2 MiB of appended data. Mixed records are parsed in memory; only IDs, configured model/effort, individual response usage and timestamps are retained locally. No upload. Pause or Finish stops reads; queued observations may still arrive. Resume requires a new pairing and explicit authorization."
                    )
                    .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("Authorize selected source", action: telemetry.authorize)
                            .disabled(!telemetry.canAuthorize)
                        Button("Stop source reads", action: telemetry.stopReading)
                            .disabled(!telemetry.isCollecting)
                    }
                    Text(
                        "After Pause or Finish, select the recording → Codex telemetry. Refresh rereads committed observations; it does not access the source."
                    )
                    .font(.caption).foregroundStyle(.secondary)
                }
                .textFieldStyle(.roundedBorder)
                .padding(4)
            }
        }
    }
}
