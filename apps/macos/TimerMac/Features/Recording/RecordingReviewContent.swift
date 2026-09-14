import SwiftUI

/// A read-only projection of committed records. Rendering never performs IO or uploads.
struct RecordingReviewContent: View {
    let recording: RecordingSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(recording.intention).font(.headline)
            if recording.capturesForegroundApplications {
                Text("Foreground app identities only · local until deleted · no upload")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Divider()
            RecordingTimelineView(timeline: RecordingTimeline(recording: recording))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
