import SwiftUI

struct RecordingWindowView: View {
    @Environment(RecordingModel.self) private var model
    @State private var recordingPendingDeletion: RecordingSnapshot?
    @State private var showingDeletionConfirmation = false
    @State private var showingConnections = false

    var body: some View {
        @Bindable var model = model

        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Local Recordings").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                    RecordingHeaderStatusView()
                }
                .frame(width: 300, alignment: .leading)
                Spacer(minLength: 16)
                RecordingControlsView()
                Spacer(minLength: 16)
                Button("Connections", systemImage: "link") { showingConnections = true }
                    .help("Manage Codex notes and local activity pairing")
            }
            RecordingTaskControlsView()
            Divider()
            HStack(alignment: .top, spacing: 16) {
                List(selection: $model.selectedID) {
                    ForEach(model.recordings) { recording in
                        RecordingListRow(recording: recording)
                            .tag(recording.id)
                    }
                }
                .frame(width: 210)
                .listStyle(.inset)
                .scrollContentBackground(.hidden)
                .accessibilityLabel("Saved local recordings")
                if let selected = model.selected {
                    VStack(alignment: .leading, spacing: 10) {
                        RecordingReviewView(recording: selected)
                        if selected.status != .recording {
                            RecordingDeleteButton {
                                recordingPendingDeletion = selected
                                showingDeletionConfirmation = true
                            }
                        }
                    }
                } else {
                    ContentUnavailableView(
                        model.errorMessage == nil ? "No local recordings" : "History unavailable",
                        systemImage: model.errorMessage == nil ? "record.circle" : "exclamationmark.triangle",
                        description: Text(
                            model.errorMessage == nil
                                ? "Start recording to see application activity here."
                                : "Retry loading local history.")
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Label("Stored on this Mac · No upload · Local storage is unencrypted", systemImage: "internaldrive")
                .font(.callout).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $showingConnections) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        Text("Recording connections").font(.title2.bold())
                        Spacer()
                        Button("Done") { showingConnections = false }
                            .keyboardShortcut(.cancelAction)
                    }
                    AutomaticCodexCaptureView()
                    Divider()
                    LocalHarnessView()
                    Divider()
                    LocalCodexPairingView()
                    LocalCodexTelemetryView()
                    Text(
                        "Foreground capture stores app name, bundle ID and PID only. It never reads window contents, documents, input or your screen."
                    )
                    .font(.callout).foregroundStyle(.secondary)
                }
                .padding(24)
            }
            .frame(width: 620, height: 540)
        }
        .task {
            model.load()
            await model.waitForIdle()
        }
        .confirmationDialog(
            "Delete this local recording?", isPresented: $showingDeletionConfirmation, titleVisibility: .visible
        ) {
            Button("Delete recording", role: .destructive) {
                if let recordingPendingDeletion { model.delete(recordingPendingDeletion) }
                recordingPendingDeletion = nil
            }
        } message: {
            Text("This removes the recording and its local event history from this Mac.")
        }
    }
}

private struct RecordingHeaderStatusView: View {
    @Environment(RecordingModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.saveStatus).font(.callout).foregroundStyle(.secondary)
                .lineLimit(1)
                .accessibilityIdentifier("recording-save-status")
            Text(model.telemetry.status).font(.caption).foregroundStyle(.secondary)
                .lineLimit(1)
                .help(model.telemetry.status)
        }
    }
}

private struct RecordingDeleteButton: View {
    @Environment(RecordingModel.self) private var model
    let action: () -> Void

    var body: some View {
        Button("Delete recording…", systemImage: "trash", role: .destructive, action: action)
            .disabled(!model.canDeleteRecording)
            .buttonStyle(.borderless)
            .font(.callout)
            .padding(.vertical, 4)
    }
}
