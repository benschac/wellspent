import SwiftUI

struct RecordingWindowView: View {
    @Environment(RecordingModel.self) private var model

    var body: some View {
        @Bindable var model = model

        VStack(alignment: .leading, spacing: 16) {
            Text("Recording preview").font(.title2.bold())
            Text("Try a local recording with sample events. Live app observation and agent capture are off.")
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
                .accessibilityLabel("Saved sample recordings")
                if let selected = model.selected {
                    RecordingReviewView(recording: selected)
                } else {
                    ContentUnavailableView(
                        model.errorMessage == nil ? "No sample recordings" : "History unavailable",
                        systemImage: model.errorMessage == nil ? "record.circle" : "exclamationmark.triangle",
                        description: Text(
                            model.errorMessage == nil
                                ? "Start a sample to try pause, resume, and recovery." : "Retry loading local history.")
                    )
                }
            }
            Text(
                "Samples stay on this Mac in an unencrypted preview store. Recording intervals do not measure focused human time."
            )
            .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(minWidth: 780, minHeight: 520)
        .task {
            model.load()
            await model.waitForIdle()
        }
    }
}
