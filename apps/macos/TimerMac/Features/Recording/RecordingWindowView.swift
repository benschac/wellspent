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
                RecordingControlsView()
                Spacer(minLength: 0)
                Button("Connections", systemImage: "link") { showingConnections = true }
                    .help("Manage Codex notes and local activity pairing")
            }
            Divider()
            HStack(alignment: .top, spacing: 16) {
                List(selection: $model.selectedID) {
                    ForEach(model.recordings) { recording in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(recording.intention).font(.headline).lineLimit(2)
                            if let started = recording.intervals.first?.start.wall {
                                Text(started, format: .dateTime.month(.abbreviated).day().hour().minute())
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Text(recording.status.rawValue.capitalized).font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 6)
                        .tag(recording.id)
                    }
                }
                .frame(minWidth: 180, idealWidth: 210, maxWidth: 230)
                .listStyle(.inset)
                .scrollContentBackground(.hidden)
                .accessibilityLabel("Saved local recordings")
                if let selected = model.selected {
                    VStack(alignment: .leading, spacing: 10) {
                        RecordingReviewView(recording: selected)
                        if selected.status != .recording {
                            Button("Delete this local recording", role: .destructive) {
                                recordingPendingDeletion = selected
                                showingDeletionConfirmation = true
                            }
                            .disabled(!model.canAct)
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
                .font(.footnote).foregroundStyle(.secondary)
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
                    LocalHarnessView()
                    Divider()
                    LocalCodexPairingView()
                    Text(
                        "Foreground capture stores app name, bundle ID and PID only. It never reads window contents, documents, input or your screen."
                    )
                    .font(.caption).foregroundStyle(.secondary)
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
