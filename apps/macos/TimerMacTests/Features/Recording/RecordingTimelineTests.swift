import Foundation
import Testing

@testable import TimerMac

struct RecordingTimelineTests {
    private let fixture = RecordingSnapshotFixture()

    @Test
    func ordersDelayedSourceReportedAgentEventWithinItsClosedInterval() throws {
        var recording = try fixture.started()
        try recording.append(fixture.event(.note, seconds: 4, text: "Note saved first"))
        try recording.append(fixture.event(.finish, seconds: 10))
        let delayedAgent = fixture.event(
            .agentCompletion, seconds: 30, occurredAt: fixture.wall(2), text: "Delayed agent report")
        try recording.append(delayedAgent)

        let interval = try #require(RecordingTimeline(recording: recording).intervals.first)
        let expectedEventIDs = [
            recording.events[0].id,
            delayedAgent.id,
            recording.events[1].id,
            recording.events[2].id,
        ]

        #expect(interval.entries.map(\.event.id) == expectedEventIDs.reversed())
        #expect(interval.entries[2].timeSource == .sourceReportedOccurrence)
        #expect(interval.entries[2].timelineTime == fixture.wall(2))
    }

    @Test
    func ordersDelayedCodexReportByHookReceiptInsteadOfNativeSaveTime() throws {
        var recording = try fixture.started()
        try recording.append(fixture.event(.note, seconds: 4, text: "Note saved first"))
        try recording.append(fixture.event(.finish, seconds: 10))
        let report = try hookReport(
            recording: recording, hookReceivedAt: fixture.wall(2),
            nativeReceivedAt: fixture.event(.start, seconds: 30).stamp)
        try recording.append(report)

        let interval = try #require(RecordingTimeline(recording: recording).intervals.first)
        #expect(interval.entries[2].event.id == report.id)
        #expect(interval.entries[2].timeSource == .hookReceipt)
        #expect(interval.entries[2].timelineTime == fixture.wall(2))
        #expect(interval.entries[2].timelineTime != report.stamp.wall)
    }

    @Test
    func exposesKnownCoverageGapAndEmptyResumedInterval() throws {
        var recording = try fixture.started()
        try recording.append(fixture.event(.pause, seconds: 10))
        let resumedID = UUID()
        try recording.append(fixture.event(.resume, seconds: 20, intervalID: resumedID))
        try recording.append(fixture.event(.finish, seconds: 25, intervalID: resumedID))

        let timeline = RecordingTimeline(recording: recording)
        let first = try #require(timeline.intervals.last)
        let second = try #require(timeline.intervals.first)
        let gap = try #require(first.gapAfter)
        #expect(gap.previousEnd == fixture.wall(10))
        #expect(gap.nextStart == fixture.wall(20))
        #expect(second.hasObservations == false)
    }

    @Test
    func preservesUnknownCoverageBeforeResumingAfterInterruption() throws {
        var recording = try fixture.started()
        try recording.append(fixture.event(.interrupt, seconds: 10, processID: UUID()))
        let resumedID = UUID()
        let resumedProcess = UUID()
        try recording.append(fixture.event(.resume, seconds: 20, intervalID: resumedID, processID: resumedProcess))
        try recording.append(fixture.event(.finish, seconds: 25, intervalID: resumedID, processID: resumedProcess))

        let first = try #require(RecordingTimeline(recording: recording).intervals.last)
        let gap = try #require(first.gapAfter)
        #expect(first.coverage == .endUnknown)
        #expect(gap.endIsKnown == false)
        #expect(gap.nextStart == fixture.wall(20))
    }

    @Test
    func newestIntervalsAndEqualTimeEventsAppearFirstWithoutChangingEvidence() throws {
        var recording = try fixture.started()
        try recording.append(fixture.event(.pause, seconds: 10))
        let resumedID = UUID()
        try recording.append(fixture.event(.resume, seconds: 20, intervalID: resumedID))
        let firstNote = fixture.event(.note, seconds: 21, intervalID: resumedID, text: "First")
        let secondNote = fixture.event(.note, seconds: 21, intervalID: resumedID, text: "Second")
        try recording.append(firstNote)
        try recording.append(secondNote)
        let originalEvents = recording.events

        let timeline = RecordingTimeline(recording: recording)
        #expect(timeline.intervals.map(\.ordinal) == [2, 1])
        let newest = try #require(timeline.intervals.first)
        #expect(Array(newest.entries.prefix(2).map(\.id)) == [secondNote.id, firstNote.id])
        #expect(recording.events == originalEvents)
    }

    private func hookReport(
        recording: RecordingSnapshot, hookReceivedAt: Date, nativeReceivedAt: RecordingEvent.Stamp
    ) throws -> RecordingEvent {
        let intervalID = try #require(recording.intervals.first?.id)
        let draft = CodexIntakeContract.Metadata(
            version: 1, eventID: UUID(), senderID: "sender", bindingID: UUID(), localScopeID: recording.localScopeID,
            recordingID: recording.id, intervalID: intervalID, threadID: "thread", turnID: "turn", invocationID: "tool",
            kind: "PostToolUse", hookReceivedAt: CodexIntakeContract.timestamp(hookReceivedAt), occurredAt: nil,
            timeBasis: "hookReceived", toolName: "Bash", reportedResult: "unknown")
        let eventID = try #require(draft.stableID)
        let metadata = CodexIntakeContract.Metadata(
            version: draft.version, eventID: eventID, senderID: draft.senderID, bindingID: draft.bindingID,
            localScopeID: draft.localScopeID, recordingID: draft.recordingID, intervalID: draft.intervalID,
            threadID: draft.threadID, turnID: draft.turnID, invocationID: draft.invocationID, kind: draft.kind,
            hookReceivedAt: draft.hookReceivedAt, occurredAt: nil, timeBasis: draft.timeBasis,
            toolName: draft.toolName, reportedResult: draft.reportedResult)
        var fields = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(metadata)) as? [String: Any])
        fields["occurredAt"] = NSNull()
        let exactBody = try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])

        return RecordingEvent(
            id: eventID, localScopeID: recording.localScopeID, recordingID: recording.id, intervalID: intervalID,
            kind: .agentCompletion, stamp: nativeReceivedAt, timeBasis: .hookReceived,
            agentMetadata: CodexAgentMetadata(
                metadata: metadata, exactBody: exactBody, bodyDigest: CodexIntakeContract.digest(exactBody)))
    }
}
