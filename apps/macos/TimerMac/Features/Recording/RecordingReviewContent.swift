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
            Text("Committed events · UTC · Shown in save order").font(.caption).foregroundStyle(.secondary)
            ForEach(recording.intervals) { interval in
                HStack {
                    Text("Interval \(interval.id.uuidString.prefix(8))")
                    if let duration = interval.committedDuration {
                        Text("\(duration, format: .number.precision(.fractionLength(1))) seconds recorded")
                    } else {
                        Text(interval.interrupted ? "Coverage end unknown" : "No committed end yet")
                    }
                }
                .font(.caption)
            }
            Divider()
            ForEach(recording.events) { event in
                VStack(alignment: .leading, spacing: 4) {
                    Text(event.sourceLabel).font(.subheadline.bold())
                    Text(event.text.isEmpty ? event.kind.rawValue.capitalized : event.text)
                    Text(
                        event.stamp.wall, format: Date.FormatStyle(date: .numeric, time: .standard, timeZone: .gmt)
                    )
                    .font(.caption).foregroundStyle(.secondary)
                    if let agent = event.agentMetadata {
                        Text("Hook received: \(agent.metadata.hookReceivedAt) · occurrence unknown")
                            .font(.caption)
                        Text(
                            "Native receipt shown above · Reported result: \(agent.metadata.reportedResult) · completion unverified"
                        )
                        .font(.caption)
                        Text(
                            "Thread \(agent.metadata.threadID) · \(agent.metadata.kind) · \(agent.metadata.toolName ?? "Turn stop")"
                        )
                        .font(.caption)
                        Text("Event \(event.id.uuidString)").font(.caption2).foregroundStyle(.secondary)
                    }
                    if let occurredAt = event.occurredAt {
                        Text(
                            "Source-reported occurrence: \(occurredAt.formatted(Date.FormatStyle(date: .numeric, time: .standard, timeZone: .gmt))) UTC"
                        )
                        .font(.caption)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                Divider()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
