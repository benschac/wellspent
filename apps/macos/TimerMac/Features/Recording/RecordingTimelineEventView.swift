import SwiftUI

struct RecordingTimelineEventView: View {
    let entry: RecordingTimeline.Entry

    var body: some View {
        let event = entry.event

        VStack(alignment: .leading, spacing: 4) {
            Text(event.sourceLabel).font(.subheadline.bold())
            Text(event.text.isEmpty ? event.kind.rawValue.capitalized : event.text)
            Text(entry.timelineTime, format: Date.FormatStyle(date: .numeric, time: .standard, timeZone: .gmt))
                .font(.caption).foregroundStyle(.secondary)
            Text(entry.timeSource.label).font(.caption).foregroundStyle(.secondary)
            if entry.timelineTime != event.stamp.wall {
                Text(event.stamp.wall, format: Date.FormatStyle(date: .numeric, time: .standard, timeZone: .gmt))
                    .font(.caption).foregroundStyle(.secondary)
                Text("Saved locally at the time above").font(.caption).foregroundStyle(.secondary)
            }
            if let agent = event.agentMetadata {
                Text("Reported result: \(agent.metadata.reportedResult) · completion unverified")
                    .font(.caption)
                Text(
                    "Thread \(agent.metadata.threadID) · \(agent.metadata.kind) · \(agent.metadata.toolName ?? "Turn stop")"
                )
                .font(.caption)
                Text("Event \(event.id.uuidString)").font(.caption2).foregroundStyle(.secondary)
            }
            if event.workNote != nil {
                Text("Explicitly submitted note. This does not verify completion or focused time.")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Event \(event.id.uuidString)").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
        .accessibilityElement(children: .combine)
    }
}
