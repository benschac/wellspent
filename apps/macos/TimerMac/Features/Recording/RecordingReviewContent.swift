import SwiftUI

/// Committed evidence with separate, explicit review actions. Rendering never writes or uploads.
struct RecordingReviewContent: View {
    @Environment(RecordingModel.self) private var model
    let recording: RecordingSnapshot

    private var observationCount: Int { recording.events.filter { $0.kind.isObservation }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(recording.capturesForegroundApplications ? "Application activity" : recording.intention)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 12)
                    RecordingStatusLabel(status: recording.status)
                }
                HStack(spacing: 16) {
                    if let started = recording.intervals.first?.start.wall {
                        Text(started, format: .dateTime.month(.wide).day().year())
                    }
                    Spacer(minLength: 0)
                    Label(
                        "\(recording.intervals.count) \(recording.intervals.count == 1 ? "interval" : "intervals")",
                        systemImage: "waveform.path")
                    Label(
                        "\(observationCount) \(observationCount == 1 ? "recording observation" : "recording observations")",
                        systemImage: "square.stack")
                }
                .font(.body).foregroundStyle(.secondary)
            }
            RecordingTaskHistoryView(recordingID: recording.id)
            Divider()
            if recording.status != .recording {
                RecordingTelemetryReviewView(recording: recording)
                Divider()
            }
            if recording.status == .recording {
                ForEach(Array(Set(model.liveTelemetryWarnings.values)).sorted(), id: \.self) { warning in
                    Label(warning, systemImage: "exclamationmark.triangle")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Text(
                    "Codex activity appears here as it arrives. Eligible pending metadata is saved after Pause or Finish; missing usage remains unknown."
                )
                .font(.callout).foregroundStyle(.secondary)
            }
            RecordingTimelineView(timeline: RecordingTimeline(recording: recording), recordingID: recording.id)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
