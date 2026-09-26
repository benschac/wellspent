import SwiftUI

/// A read-only projection of committed records. Rendering never performs IO or uploads.
struct RecordingReviewContent: View {
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
                        "\(observationCount) \(observationCount == 1 ? "observation" : "observations")",
                        systemImage: "square.stack")
                }
                .font(.body).foregroundStyle(.secondary)
            }
            Divider()
            RecordingTimelineView(timeline: RecordingTimeline(recording: recording))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
