import SwiftUI

struct RecordingListRow: View {
    let recording: RecordingSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let started = recording.intervals.first?.start.wall {
                Text(started, format: .dateTime.month(.abbreviated).day())
                    .font(.headline)
                Text(started, format: .dateTime.hour().minute())
                    .font(.body).foregroundStyle(.secondary)
            }
            Text(recording.capturesForegroundApplications ? "Application activity" : recording.intention)
                .font(.body).lineLimit(2)
            RecordingStatusLabel(status: recording.status)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }
}
