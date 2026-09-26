import Foundation
import Testing

@testable import TimerMac

@MainActor
@Suite(.timeLimit(.minutes(1)))
struct TimerRecordingControllerTests {
    @Test
    func cancelledIntentCannotStartLater() async {
        let (controls, timer, repository) = makeControls()
        controls.toggle()
        controls.toggle()
        await controls.waitForIdle()
        #expect(!timer.isRunning)
        #expect(controls.recording.current == nil)
        #expect(await repository.attempts.isEmpty)
    }

    @Test
    func existingForegroundRecordingIsReusedAndSuspensionNeedsExplicitResume() async throws {
        let (controls, timer, _) = makeControls()
        controls.recording.load()
        await controls.recording.waitForIdle()
        controls.recording.startForegroundApplicationRecording()
        await controls.recording.waitForIdle()
        let original = try #require(controls.recording.current)
        controls.start()
        await controls.waitForIdle()
        #expect(timer.isRunning)
        #expect(controls.recording.current == original)
        controls.recording.suspendForLifecycle(reason: "Test sleep")
        await controls.recording.waitForIdle()
        #expect(!controls.recording.canCaptureForegroundApplications)
        #expect(controls.recording.current?.status == .suspended)
        controls.pause()
        await controls.waitForIdle()
        controls.start()
        await controls.waitForIdle()
        #expect(controls.recording.current?.id == original.id)
        #expect(controls.recording.current?.intervals.count == 2)
        #expect(controls.recording.canCaptureForegroundApplications)
        controls.pause()
        await controls.waitForIdle()
    }

    @Test
    func startPauseResumeAndResetPreserveRecordingHistory() async throws {
        let (controls, timer, repository) = makeControls()
        controls.toggle()
        await controls.waitForIdle()
        #expect(timer.isRunning)
        #expect(controls.recording.canCaptureForegroundApplications)
        let original = try #require(controls.recording.current)
        controls.recording.recordForegroundApplication(
            .init(bundleIdentifier: "test.editor", localizedName: "Editor", processIdentifier: 42))
        await controls.recording.waitForIdle()

        controls.toggle()
        #expect(!timer.isRunning)
        #expect(!controls.recording.canCaptureForegroundApplications)
        #expect(controls.recording.activeHarnessInterval == nil)
        await controls.waitForIdle()
        #expect(controls.recording.current?.status == .paused)
        controls.recording.recordForegroundApplication(
            .init(bundleIdentifier: "test.other", localizedName: "Excluded", processIdentifier: 43))

        controls.toggle()
        await controls.waitForIdle()
        #expect(timer.isRunning)
        #expect(controls.recording.current?.id == original.id)
        #expect(controls.recording.current?.intervals.count == 2)
        let beforeReset = controls.recording.current
        timer.reset()
        #expect(timer.isRunning)
        #expect(controls.recording.current == beforeReset)
        #expect(await repository.attempts.filter { $0.kind == .application }.count == 1)
        controls.pause()
        await controls.waitForIdle()
    }

    @Test(arguments: [false, true])
    func pauseWhileStartIsSavingNeverStartsTimerOrCapture(resuming: Bool) async throws {
        let (controls, timer, repository) = makeControls()
        if resuming {
            controls.start()
            await controls.waitForIdle()
            controls.pause()
            await controls.waitForIdle()
        }
        await repository.holdNextCommit()
        controls.toggle()
        await repository.waitUntilCommitHeld()
        #expect(controls.isStarting)
        #expect(!timer.isRunning)
        controls.toggle()
        #expect(!controls.isStarting)
        #expect(!controls.recording.acceptingEvents)
        await repository.releaseCommit()
        await controls.waitForIdle()
        #expect(!timer.isRunning)
        #expect(controls.recording.current?.status == .paused)
        #expect(
            await repository.attempts.map(\.kind) == (resuming ? [.start, .pause, .resume, .pause] : [.start, .pause]))
    }

    @Test
    func pauseQueuesBehindObservationAndExcludesLaterEvents() async throws {
        let (controls, timer, repository) = makeControls()
        controls.start()
        await controls.waitForIdle()
        await repository.holdNextCommit()
        controls.recording.recordForegroundApplication(
            .init(bundleIdentifier: "test.editor", localizedName: "Editor", processIdentifier: 42))
        await repository.waitUntilCommitHeld()
        controls.pause()
        controls.pause()
        #expect(!timer.isRunning)
        #expect(!controls.recording.canCaptureForegroundApplications)
        controls.recording.recordForegroundApplication(
            .init(bundleIdentifier: "test.other", localizedName: "Excluded", processIdentifier: 43))
        await repository.releaseCommit()
        await controls.waitForIdle()
        let events = try #require(controls.recording.current).events
        #expect(events.map(\.kind) == [.start, .application, .pause])
        #expect(events[1].stamp.uptime < events[2].stamp.uptime)
        #expect(controls.recording.current?.status == .paused)
    }

    @Test
    func failedStartStaysStoppedAndRetryRequiresExplicitResume() async throws {
        let (controls, timer, repository) = makeControls()
        await repository.failNext()
        controls.start()
        await controls.waitForIdle()
        #expect(!timer.isRunning)
        #expect(!controls.recording.acceptingEvents)
        #expect(controls.errorMessage != nil)
        let pending = try #require(controls.recording.pendingEvent)
        controls.recording.retry()
        await controls.recording.waitForIdle()
        #expect(!timer.isRunning)
        #expect(controls.recording.current?.status == .interrupted)
        #expect(controls.recording.current?.events.first == pending)
        controls.start()
        await controls.waitForIdle()
        #expect(timer.isRunning)
        #expect(controls.recording.canCaptureForegroundApplications)
        controls.pause()
        await controls.waitForIdle()
    }

    @Test
    func pausePreservesFailedObservationAndUnknownCoverageForRetry() async throws {
        let (controls, timer, repository) = makeControls()
        controls.start()
        await controls.waitForIdle()
        await repository.failNext()
        controls.recording.recordForegroundApplication(
            .init(bundleIdentifier: "test.editor", localizedName: "Editor", processIdentifier: 42))
        await controls.recording.waitForIdle()
        let pending = try #require(controls.recording.pendingEvent)
        controls.pause()
        #expect(!timer.isRunning)
        #expect(controls.recording.pendingEvent == pending)
        controls.recording.retry()
        await controls.recording.waitForIdle()
        #expect(controls.recording.current?.status == .interrupted)
        #expect(controls.recording.current?.intervals.last?.interrupted == true)
        #expect(controls.recording.current?.events.filter { $0.id == pending.id }.count == 1)
        #expect(!controls.recording.acceptingEvents)
    }

    @Test
    func manualFinishAllowsNewRecordingAndSampleIsNotRepurposed() async throws {
        let (controls, timer, _) = makeControls()
        controls.recording.load()
        await controls.recording.waitForIdle()
        controls.recording.startRecording()
        await controls.recording.waitForIdle()
        let sample = try #require(controls.recording.current)
        controls.start()
        await controls.waitForIdle()
        #expect(!timer.isRunning)
        #expect(controls.errorMessage != nil)
        #expect(controls.recording.current == sample)
        controls.recording.finish()
        await controls.recording.waitForIdle()
        controls.start()
        await controls.waitForIdle()
        #expect(timer.isRunning)
        #expect(controls.recording.current?.id != sample.id)
        #expect(controls.recording.recordings.count == 2)
        controls.pause()
        await controls.waitForIdle()
    }

    @Test
    func relaunchAndRemoteSnapshotRequireLocalStartToResumeCapture() async throws {
        let (first, _, repository) = makeControls()
        first.start()
        await first.waitForIdle()
        let original = try #require(first.recording.current)
        first.cancelPendingStart()
        let (controls, timer, _) = makeControls(repository: repository)
        controls.recording.load()
        await controls.recording.waitForIdle()
        #expect(controls.recording.current?.status == .interrupted)
        #expect(!controls.recording.acceptingEvents)
        timer.handle(
            event: .stateReceived(
                .init(elapsedMilliseconds: 1000, isRunning: true, revision: 1, updatedAt: Date.now.ISO8601Format())))
        #expect(!controls.recording.acceptingEvents, "A remote stopwatch state must not authorize capture")
        controls.pause()
        await controls.waitForIdle()
        controls.start()
        await controls.waitForIdle()
        #expect(controls.recording.current?.id == original.id)
        #expect(controls.recording.canCaptureForegroundApplications)
        controls.pause()
        await controls.waitForIdle()
    }

    private func makeControls(repository: RecordingModelRepositoryFixture = RecordingModelRepositoryFixture())
        -> (TimerRecordingController, TimerModel, RecordingModelRepositoryFixture)
    {
        let timer = TimerModel()
        let clock = RecordingModelClockFixture()
        let recording = RecordingModel(repository: repository, stamp: clock.stamp)
        return (TimerRecordingController(timer: timer, recording: recording), timer, repository)
    }
}
