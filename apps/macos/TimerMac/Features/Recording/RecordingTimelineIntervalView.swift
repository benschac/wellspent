import SwiftUI

struct RecordingTimelineIntervalView: View {
    let interval: RecordingTimeline.Interval

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let gap = interval.gapAfter {
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("No collection coverage").font(.headline)
                        if let end = gap.previousEnd {
                            Text("\(end.formatted(Self.timestamp)) → \(gap.nextStart.formatted(Self.timestamp))")
                        } else {
                            Text("Previous end unknown · resumed \(gap.nextStart.formatted(Self.timestamp))")
                        }
                    }
                } icon: {
                    Image(systemName: "pause.circle")
                }
                .font(.body).foregroundStyle(.secondary)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                .padding(.bottom, 20)
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(interval.start, format: Date.FormatStyle(date: .abbreviated, time: .omitted, timeZone: .gmt))
                        .font(.headline)
                    Spacer()
                    Text("Interval \(interval.ordinal)").font(.body).foregroundStyle(.secondary)
                }
                switch interval.coverage {
                case .closed(let duration):
                    Text(
                        "\(Duration.seconds(duration).formatted(.units(allowed: [.hours, .minutes, .seconds], width: .abbreviated))) recorded coverage"
                    )
                    .font(.body).foregroundStyle(.secondary)
                case .endUnknown:
                    Label("Coverage end unknown after interruption", systemImage: "exclamationmark.circle")
                        .font(.body).foregroundStyle(.orange)
                case .open:
                    Text("No committed end yet").font(.body).foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 12)

            ForEach(interval.entries) { entry in
                RecordingTimelineEventView(entry: entry, isLast: entry.id == interval.entries.last?.id)
            }
            if !interval.hasObservations {
                Text("No app activity or notes in this interval.")
                    .font(.callout).foregroundStyle(.secondary)
                    .padding(.leading, 180)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private static let timestamp = Date.FormatStyle(date: .abbreviated, time: .shortened, timeZone: .gmt)
}
