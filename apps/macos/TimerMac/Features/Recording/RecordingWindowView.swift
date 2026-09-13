import SwiftUI

struct RecordingWindowView: View {
    @Environment(RecordingModel.self) private var model
    @State private var recordingPendingDeletion: RecordingSnapshot?
    @State private var showingDeletionConfirmation = false

    var body: some View {
        @Bindable var model = model

        VStack(alignment: .leading, spacing: 16) {
            Text("Local recordings").font(.title2.bold())
            Text("Try a synthetic sample or explicitly record foreground app transitions. Agent capture is off.")
                .foregroundStyle(.secondary)
            RecordingControlsView()
            Divider()
            HStack(alignment: .top, spacing: 16) {
                List(selection: $model.selectedID) {
                    ForEach(model.recordings) { recording in
                        VStack(alignment: .leading) {
                            Text(recording.intention)
                            Text(recording.status.rawValue.capitalized).font(.caption).foregroundStyle(.secondary)
                        }
                        .tag(recording.id)
                    }
                }
                .frame(minWidth: 190, idealWidth: 220, maxWidth: 270)
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
                                ? "Start a sample or foreground app recording to try pause, resume, and recovery."
                                : "Retry loading local history.")
                    )
                }
            }
            Text(
                "Recordings stay on this Mac until you delete them. They are not uploaded. The local store is currently unencrypted, and intervals do not measure focused human time."
            )
            .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(minWidth: 780, minHeight: 520)
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
