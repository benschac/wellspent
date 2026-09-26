import SwiftUI

struct AutomaticCodexCaptureView: View {
    @Environment(RecordingModel.self) private var recording

    var body: some View {
        @Bindable var capture = recording.telemetry.automatic
        GroupBox("Codex activity") {
            VStack(alignment: .leading, spacing: 10) {
                Text(capture.status).font(.callout)
                    .accessibilityIdentifier("automatic-codex-status")
                LabeledContent("Authorized directory", value: capture.directoryName)
                if let loaded = capture.loadedSessionCount, let inScope = capture.inScopeSessionCount {
                    Text("Codex API: \(loaded) loaded sessions · \(inScope) inside the authorized directory")
                        .font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier("automatic-codex-api-counts")
                }
                Text(
                    "Choose your Codex session directory once. Enable Include Codex activity for a recording, then use ordinary Codex instances. The local harness starts with bun run dev."
                )
                .font(.caption).foregroundStyle(.secondary)
                Text(
                    "Only assigned chat names when available, session and response identities, configured model and effort, individual response usage, timestamps and capture diagnostics are kept on this Mac. Mixed records are parsed transiently; prompts, answers and tool output are not retained or uploaded. Existing content and pause gaps are excluded; new sessions start at their enrollment EOF, so coverage is partial."
                )
                .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button(
                        capture.hasDirectory ? "Change session directory…" : "Authorize session directory…",
                        action: capture.chooseDirectory
                    )
                    .disabled(capture.isCollecting || capture.isBusy || capture.isChoosingDirectory)
                    .accessibilityIdentifier("authorize-codex-directory")
                    Button("Revoke directory", action: capture.revokeDirectory)
                        .disabled(!capture.hasDirectory)
                }
                Toggle("Include Codex activity", isOn: $capture.includeCodexActivity)
                    .disabled(!capture.hasDirectory || !recording.canAct)
                    .accessibilityIdentifier("connections-include-codex-activity")
                Toggle("Find sessions through Codex API", isOn: $capture.useAppServerDiscovery)
                    .disabled(!capture.canChangeDiscoveryMode)
                    .accessibilityIdentifier("automatic-codex-api-discovery")
                Text(
                    "For this recording, connect to the running local Codex server to check loaded session metadata. Telemetry is read only inside your authorized directory. This does not start or resume Codex sessions or import history. Loaded sessions may be idle; separate Codex servers may not be visible. Choose before starting or resuming recording."
                )
                .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Stop Codex capture", action: capture.stop)
                        .disabled(!capture.isCollecting && !capture.isBusy)
                    Button("Restart Codex capture", action: capture.restart)
                        .disabled(
                            capture.isCollecting || capture.isBusy || !capture.includeCodexActivity
                                || !recording.acceptingEvents)
                }
                Text(
                    "Pause and Finish stop discovery and reads immediately; eligible queued metadata can still arrive. Resume creates new bindings and EOF baselines. Reopening never restarts capture. Revoke removes directory authorization and stops future reads; eligible queued observations may still arrive. Limits: 16 sessions, 512 directory entries per bounded pass, 2 MiB per source, 64 MiB overall and 8 hours per authorization. Exhaustion stops capture visibly."
                )
                .font(.caption).foregroundStyle(.secondary)
                Text(
                    "After Pause or Finish, select the recording → Codex telemetry to inspect committed configuration and individual response usage."
                )
                .font(.caption).foregroundStyle(.secondary)
            }
            .padding(4)
        }
    }
}
