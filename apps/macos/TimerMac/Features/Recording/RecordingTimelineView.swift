import SwiftUI

struct RecordingTimelineView: View {
    let timeline: RecordingTimeline

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Timeline").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Label("Newest first · UTC", systemImage: "arrow.down")
                        .font(.body).foregroundStyle(.secondary)
                }
                Text("Collection coverage, not focused time. Events use the closest known time.")
                    .font(.body).foregroundStyle(.secondary)
            }
            ForEach(timeline.intervals) { interval in
                RecordingTimelineIntervalView(interval: interval)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
