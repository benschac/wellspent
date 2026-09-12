import SwiftUI

/// A read-only projection of committed records. Rendering never performs IO or uploads.
struct RecordingReviewContent: View {
    let recording: RecordingSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(recording.intention).font(.headline)
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
