import Foundation
import Testing

@testable import TimerMac

struct RecordingSnapshotTests {
    private let fixture = RecordingSnapshotFixture()

    @Test func explicitBoundariesCreateSeparateAuthorizedIntervals() throws {
        var snapshot = try fixture.started()
        let resumedInterval = UUID()
        try snapshot.append(fixture.event(.pause, seconds: 10))
        #expect(snapshot.status == .paused)
        #expect(snapshot.activeIntervalID == nil)
        #expect(snapshot.intervals.first?.committedDuration == 10)

        try snapshot.append(fixture.event(.resume, seconds: 20, intervalID: resumedInterval))
        #expect(snapshot.status == .recording)
        #expect(snapshot.activeIntervalID == resumedInterval)
        try snapshot.append(fixture.event(.finish, seconds: 25, intervalID: resumedInterval))
        #expect(snapshot.status == .finished)
        #expect(snapshot.activeIntervalID == nil)
        #expect(snapshot.intervals.map(\.committedDuration) == [10, 5])
        #expect(try RecordingSnapshot.rebuild(snapshot.events) == snapshot)
    }

    @Test func suspendedRecordingRequiresExplicitResume() throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.suspend, seconds: 5))
        #expect(snapshot.status == .suspended)
        #expect(snapshot.activeIntervalID == nil)
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(.application, seconds: 6))
        }
        try snapshot.append(fixture.event(.pause, seconds: 7))
        #expect(snapshot.status == .paused)
        #expect(snapshot.intervals.first?.committedDuration == 5)
        try snapshot.append(fixture.event(.resume, seconds: 8, intervalID: UUID()))
        #expect(snapshot.status == .recording)
    }

    @Test func exactBoundaryReplayPreservesHistoryAfterStateChanges() throws {
        var snapshot = try fixture.started()
        let pause = fixture.event(.pause, seconds: 5)
        try snapshot.append(pause)
        try snapshot.append(fixture.event(.finish, seconds: 10))
        let committed = snapshot
        try snapshot.append(pause)
        #expect(snapshot == committed)
    }

    @Test func conflictingEventIdentityPreservesOriginal() throws {
        var snapshot = try fixture.started()
        let identifier = UUID()
        let original = fixture.event(.note, id: identifier, seconds: 2, text: "Original")
        try snapshot.append(original)
        try snapshot.append(original)
        let committed = snapshot
        #expect(throws: RecordingError.conflictingIdentity) {
            try snapshot.append(fixture.event(.note, id: identifier, seconds: 2, text: "Changed"))
        }
        #expect(snapshot == committed)
    }

    @Test(arguments: [RecordingEvent.Kind.start, .resume])
    func activeRecordingRejectsAdditionalStartOrResume(kind: RecordingEvent.Kind) throws {
        var snapshot = try fixture.started()
        let committed = snapshot
        #expect(throws: RecordingError.invalidTransition) {
            try snapshot.append(fixture.event(kind, seconds: 2, intervalID: UUID()))
        }
        #expect(snapshot == committed)
    }

    @Test func finishedRecordingCannotResumeOrFinishAgain() throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.finish, seconds: 10))
        #expect(throws: RecordingError.invalidTransition) {
            try snapshot.append(fixture.event(.resume, seconds: 11, intervalID: UUID()))
        }
        #expect(throws: RecordingError.invalidTransition) {
            try snapshot.append(fixture.event(.finish, seconds: 12))
        }
    }

    @Test func oldGenerationCannotRecordAfterResume() throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.pause, seconds: 5))
        #expect(throws: RecordingError.invalidTransition) {
            try snapshot.append(fixture.event(.resume, seconds: 6))
        }
        let newInterval = UUID()
        try snapshot.append(fixture.event(.resume, seconds: 7, intervalID: newInterval))
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(.application, seconds: 8))
        }
        #expect(throws: RecordingError.invalidTransition) {
            try snapshot.append(fixture.event(.pause, seconds: 9))
        }
        try snapshot.append(fixture.event(.application, seconds: 10, intervalID: newInterval))
        #expect(snapshot.events.last?.intervalID == newInterval)
    }

    @Test func otherScopeAndRecordingAreRejected() throws {
        var snapshot = try fixture.started()
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(.note, seconds: 1, scope: "other-account"))
        }
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(.note, seconds: 1, recordingID: UUID()))
        }
        #expect(snapshot.events.count == 1)
    }

    @Test(arguments: [0.0, 5.0, 10.0])
    func delayedAgentReportAcceptsClosedIntervalIncludingEndpoints(occurred: Double) throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.finish, seconds: 10))
        let report = fixture.event(
            .agentCompletion, seconds: 100, processID: UUID(), occurredAt: fixture.wall(occurred))
        try snapshot.append(report)
        #expect(snapshot.status == .finished)
        #expect(snapshot.events.last == report)
        #expect(snapshot.intervals.first?.committedDuration == 10)
    }

    @Test(arguments: [-0.001, 10.001])
    func delayedAgentReportOutsideClosedIntervalIsRejected(occurred: Double) throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.finish, seconds: 10))
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(.agentCompletion, seconds: 20, occurredAt: fixture.wall(occurred)))
        }
    }

    @Test(arguments: [RecordingEvent.Kind.application, .note, .agentCompletion])
    func delayedReceiverEventsCannotUseClosedIntervals(kind: RecordingEvent.Kind) throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.pause, seconds: 10))
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(kind, seconds: 11))
        }
    }

    @Test(arguments: [RecordingEvent.Kind.application, .note])
    func sourceReportedTimeDoesNotAuthorizeOtherObservationKinds(kind: RecordingEvent.Kind) throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.finish, seconds: 10))
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(kind, seconds: 20, occurredAt: fixture.wall(5)))
        }
    }

    @Test func sourceReportedAgentRequiresClosedKnownInterval() throws {
        var snapshot = try fixture.started()
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(.agentCompletion, seconds: 5, occurredAt: fixture.wall(2)))
        }
        try snapshot.append(fixture.event(.finish, seconds: 10))
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(
                fixture.event(
                    .agentCompletion, seconds: 20, intervalID: UUID(), occurredAt: fixture.wall(2)))
        }
    }

    @Test func restartMarksUnknownCoverageAndRequiresNewInterval() throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.application, seconds: 5))
        let restartedProcess = UUID()
        try snapshot.append(fixture.event(.interrupt, seconds: 100, processID: restartedProcess))
        #expect(snapshot.status == .interrupted)
        #expect(snapshot.activeIntervalID == nil)
        let oldInterval = try #require(snapshot.intervals.first)
        #expect(oldInterval.interrupted)
        #expect(oldInterval.end == nil)
        #expect(oldInterval.committedDuration == nil)
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(.agentCompletion, seconds: 101, occurredAt: fixture.wall(3)))
        }
        let resumedInterval = UUID()
        try snapshot.append(
            fixture.event(
                .resume, seconds: 102, intervalID: resumedInterval, processID: restartedProcess))
        try snapshot.append(
            fixture.event(
                .finish, seconds: 105, intervalID: resumedInterval, processID: restartedProcess))
        #expect(snapshot.intervals.map(\.committedDuration) == [nil, 3])
    }

    @Test func monotonicDurationSurvivesWallClockRollback() throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.finish, seconds: 10, wallSeconds: -100))
        #expect(snapshot.intervals.first?.committedDuration == 10)
    }

    @Test func boundaryCannotCloseBeforeCommittedObservation() throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.application, seconds: 10))
        let committed = snapshot
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(.pause, seconds: 9))
        }
        #expect(snapshot == committed)
    }

    @Test func resumeCannotPrecedePriorPauseInSameProcess() throws {
        var snapshot = try fixture.started()
        try snapshot.append(fixture.event(.pause, seconds: 10))
        let committed = snapshot
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(.resume, seconds: 9, intervalID: UUID()))
        }
        #expect(snapshot == committed)
        try snapshot.append(fixture.event(.resume, seconds: 10, intervalID: UUID()))
        #expect(snapshot.status == .recording)
    }

    @Test(arguments: [RecordingEvent.Kind.application, .pause, .finish])
    func otherProcessCannotExtendActiveCoverage(kind: RecordingEvent.Kind) throws {
        var snapshot = try fixture.started()
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(kind, seconds: 2, processID: UUID()))
        }
    }

    @Test(arguments: [RecordingEvent.Kind.application, .pause, .finish])
    func uptimeBeforeStartCannotExtendCoverage(kind: RecordingEvent.Kind) throws {
        var snapshot = try fixture.started()
        #expect(throws: RecordingError.staleInterval) {
            try snapshot.append(fixture.event(kind, seconds: -1))
        }
    }
}
