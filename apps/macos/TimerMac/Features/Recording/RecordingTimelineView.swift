import SwiftUI

struct RecordingTimelineView: View {
    let timeline: RecordingTimeline

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Timeline").font(.title3.bold()).accessibilityAddTraits(.isHeader)
            Text("UTC · ordered by the closest known event time")
                .font(.caption).foregroundStyle(.secondary)
            Text("Intervals show collection coverage, not focused human time.")
                .font(.caption).foregroundStyle(.secondary)

            ForEach(timeline.intervals) { interval in
                VStack(alignment: .leading, spacing: 10) {
                    Text("Interval \(interval.ordinal)").font(.headline)
                    Text(interval.start, format: Date.FormatStyle(date: .numeric, time: .standard, timeZone: .gmt))
                        .font(.caption).foregroundStyle(.secondary)
                    switch interval.coverage {
                    case .closed(let duration):
                        Text("Coverage recorded for \(duration, format: .number.precision(.fractionLength(1))) seconds")
                            .font(.caption).foregroundStyle(.secondary)
                    case .endUnknown:
                        Text("Coverage end unknown after interruption")
                            .font(.caption).foregroundStyle(.orange)
                    case .open:
                        Text("Coverage has no committed end yet")
                            .font(.caption).foregroundStyle(.secondary)
                    }

                    if interval.hasObservations == false {
                        Text("No application, Codex, or user-note observations were committed in this interval.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    ForEach(interval.entries) { entry in
                        RecordingTimelineEventView(entry: entry)
                        Divider()
                    }

                    if let gap = interval.gapAfter {
                        Divider()
                        if let previousEnd = gap.previousEnd {
                            Text("Coverage gap before the next explicit Resume")
                                .font(.subheadline.bold())
                            Text(
                                "Ended: \(previousEnd.formatted(Date.FormatStyle(date: .numeric, time: .standard, timeZone: .gmt)))"
                            )
                            .font(.caption).foregroundStyle(.secondary)
                            Text(
                                "Resumed: \(gap.nextStart.formatted(Date.FormatStyle(date: .numeric, time: .standard, timeZone: .gmt)))"
                            )
                            .font(.caption).foregroundStyle(.secondary)
                        } else {
                            Text("Coverage gap before the next explicit Resume; prior coverage end is unknown")
                                .font(.subheadline.bold()).foregroundStyle(.orange)
                            Text(
                                "Next interval started: \(gap.nextStart.formatted(Date.FormatStyle(date: .numeric, time: .standard, timeZone: .gmt)))"
                            )
                            .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .contain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
