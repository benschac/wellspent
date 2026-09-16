import Foundation

/// A deterministic review projection. It never changes the saved event order or evidence.
struct RecordingTimeline: Equatable, Sendable {
    struct Interval: Equatable, Sendable, Identifiable {
        enum Coverage: Equatable, Sendable {
            case closed(TimeInterval)
            case endUnknown
            case open
        }

        struct Gap: Equatable, Sendable {
            let previousEnd: Date?
            let nextStart: Date

            var endIsKnown: Bool { previousEnd != nil }
        }

        let id: UUID
        let ordinal: Int
        let start: Date
        let coverage: Coverage
        let entries: [Entry]
        let gapAfter: Gap?

        var hasObservations: Bool { entries.contains { $0.event.kind.isObservation } }
    }

    struct Entry: Equatable, Sendable, Identifiable {
        enum TimeSource: Equatable, Sendable {
            case nativeReceipt
            case sourceReportedOccurrence
            case hookReceipt
            case noteSubmission

            var label: String {
                switch self {
                case .nativeReceipt: "Native receipt"
                case .sourceReportedOccurrence: "Source-reported occurrence"
                case .hookReceipt: "Hook receipt; occurrence unknown"
                case .noteSubmission: "MCP note submission; reported activity"
                }
            }
        }

        let event: RecordingEvent
        let timelineTime: Date
        let timeSource: TimeSource
        private let saveOrder: Int

        var id: UUID { event.id }

        fileprivate init(event: RecordingEvent, timelineTime: Date, timeSource: TimeSource, saveOrder: Int) {
            self.event = event
            self.timelineTime = timelineTime
            self.timeSource = timeSource
            self.saveOrder = saveOrder
        }

        fileprivate static func ordered(_ lhs: Self, _ rhs: Self) -> Bool {
            if lhs.timelineTime != rhs.timelineTime { return lhs.timelineTime > rhs.timelineTime }
            return lhs.saveOrder > rhs.saveOrder
        }
    }

    let intervals: [Interval]

    init(recording: RecordingSnapshot) {
        intervals = recording.intervals.enumerated().map { index, interval in
            let entries = recording.events.enumerated().compactMap { saveOrder, event in
                guard event.intervalID == interval.id else { return nil }
                let timing = Self.timing(for: event)
                return Entry(
                    event: event, timelineTime: timing.date, timeSource: timing.source, saveOrder: saveOrder)
            }
            .sorted(by: Entry.ordered)

            let gapAfter =
                recording.intervals.indices.contains(index + 1)
                ? Interval.Gap(previousEnd: interval.end?.wall, nextStart: recording.intervals[index + 1].start.wall)
                : nil

            return Interval(
                id: interval.id, ordinal: index + 1, start: interval.start.wall,
                coverage: Self.coverage(for: interval), entries: entries, gapAfter: gapAfter)
        }.reversed()
    }

    private static func coverage(for interval: RecordingSnapshot.Interval) -> Interval.Coverage {
        if let duration = interval.committedDuration { return .closed(duration) }
        return interval.interrupted ? .endUnknown : .open
    }

    private static func timing(for event: RecordingEvent) -> (date: Date, source: Entry.TimeSource) {
        if let reportedAt = event.workNote?.reportedAt { return (reportedAt, .noteSubmission) }
        switch event.timeBasis {
        case .hookReceived:
            if let hookReceivedAt = event.agentMetadata?.hookReceivedAt {
                return (hookReceivedAt, .hookReceipt)
            }
        case .sourceReported:
            if let occurredAt = event.occurredAt { return (occurredAt, .sourceReportedOccurrence) }
        case .receiver:
            break
        }
        return (event.stamp.wall, .nativeReceipt)
    }
}
