import Foundation

struct RecordingSnapshot: Equatable, Sendable, Identifiable {
    enum Status: String, Sendable { case recording, paused, suspended, interrupted, finished }

    struct Interval: Equatable, Sendable, Identifiable {
        let id: UUID
        let start: RecordingEvent.Stamp
        var end: RecordingEvent.Stamp?
        var interrupted = false

        var committedDuration: TimeInterval? {
            guard !interrupted, let end, start.processID == end.processID, end.uptime >= start.uptime else {
                return nil
            }
            return end.uptime - start.uptime
        }
    }

    let id: UUID
    let localScopeID: String
    let intention: String
    let focusLink: RecordingEvent.FocusLink?
    let captureConfiguration: RecordingEvent.CaptureConfiguration?
    private(set) var status: Status = .recording
    private(set) var events: [RecordingEvent] = []
    private(set) var intervals: [Interval] = []

    var activeIntervalID: UUID? { status == .recording ? intervals.last?.id : nil }
    var capturesForegroundApplications: Bool { captureConfiguration == .foregroundApplicationOnly }

    static func rebuild(_ events: [RecordingEvent]) throws -> Self {
        guard let first = events.first, first.kind == .start, let intervalID = first.intervalID else {
            throw RecordingError.invalidStore
        }
        try first.validate()
        var result = Self(
            id: first.recordingID, localScopeID: first.localScopeID, intention: first.text, focusLink: first.focusLink,
            captureConfiguration: first.captureConfiguration)
        result.intervals = [Interval(id: intervalID, start: first.stamp)]
        result.events = [first]
        for event in events.dropFirst() { try result.append(event) }
        return result
    }

    mutating func append(_ event: RecordingEvent) throws {
        try event.validate()
        guard event.recordingID == id, event.localScopeID == localScopeID else { throw RecordingError.staleInterval }
        if let existing = events.first(where: { $0.id == event.id }) {
            guard existing == event else { throw RecordingError.conflictingIdentity }
            return
        }
        if event.kind.isObservation {
            try validateObservation(event)
        } else {
            switch event.kind {
            case .start: throw RecordingError.invalidTransition
            case .resume:
                guard status == .paused || status == .suspended || status == .interrupted,
                    let intervalID = event.intervalID, !intervals.contains(where: { $0.id == intervalID })
                else { throw RecordingError.invalidTransition }
                if let boundary = events.last(where: { !$0.kind.isObservation }),
                    boundary.stamp.processID == event.stamp.processID
                {
                    guard event.stamp.uptime >= boundary.stamp.uptime else { throw RecordingError.staleInterval }
                }
                intervals.append(Interval(id: intervalID, start: event.stamp))
                status = .recording
            case .pause, .suspend, .finish, .interrupt:
                guard status != .finished,
                    event.intervalID == intervals.last?.id,
                    event.kind != .suspend || status == .recording,
                    event.kind != .pause || status == .recording || status == .suspended
                else { throw RecordingError.invalidTransition }
                if status == .recording, let last = intervals.indices.last {
                    if event.kind == .interrupt {
                        // Crash time is unknown. Never stretch coverage to discovery/relaunch.
                        intervals[last].interrupted = true
                    } else {
                        guard intervals[last].start.processID == event.stamp.processID,
                            event.stamp.uptime >= intervals[last].start.uptime,
                            events.filter({
                                $0.intervalID == event.intervalID && $0.stamp.processID == event.stamp.processID
                            })
                            .allSatisfy({ $0.stamp.uptime <= event.stamp.uptime })
                        else { throw RecordingError.staleInterval }
                        intervals[last].end = event.stamp
                    }
                }
                switch event.kind {
                case .pause: status = .paused
                case .suspend: status = .suspended
                case .finish: status = .finished
                default: status = .interrupted
                }
            default: throw RecordingError.invalidTransition
            }
        }
        events.append(event)
    }

    private func validateObservation(_ event: RecordingEvent) throws {
        guard let interval = intervals.first(where: { $0.id == event.intervalID }) else {
            throw RecordingError.staleInterval
        }
        if event.kind == .agentCompletion, event.timeBasis == .hookReceived,
            let hookReceivedAt = event.agentMetadata?.hookReceivedAt
        {
            guard !interval.interrupted, let end = interval.end,
                end.wall >= interval.start.wall,
                hookReceivedAt >= interval.start.wall, hookReceivedAt < end.wall,
                hookReceivedAt <= event.stamp.wall
            else { throw RecordingError.staleInterval }
        } else if event.kind == .agentCompletion, event.timeBasis == .sourceReported, let occurredAt = event.occurredAt
        {
            // Only explicit, trustworthy association to a known closed interval permits late reports.
            guard !interval.interrupted, let end = interval.end,
                occurredAt >= interval.start.wall, occurredAt <= end.wall
            else { throw RecordingError.staleInterval }
        } else {
            guard status == .recording, event.intervalID == activeIntervalID,
                event.stamp.processID == interval.start.processID,
                event.stamp.uptime >= interval.start.uptime, event.timeBasis == .receiver
            else { throw RecordingError.staleInterval }
        }
    }
}
