import Foundation
import Testing

@testable import TimerMac

@MainActor
struct RecordingModelTests {
    private let repository = RecordingModelRepositoryFixture()
    private let clock = RecordingModelClockFixture()

    private func loadedModel() async -> RecordingModel {
        let model = RecordingModel(repository: repository, stamp: clock.stamp)
        model.load()
        await model.waitForIdle()
        return model
    }

    @Test func loadingAndRepeatedRenderingRequestsNeverStartRecording() async {
        let model = await loadedModel()
        model.load()
        model.addApplicationSample()
        model.addAgentSample()
        model.addNoteSample()
        await model.waitForIdle()
        #expect(model.isLoaded)
        #expect(model.current == nil)
        #expect(model.acceptingEvents == false)
        #expect(await repository.attempts.isEmpty)
    }

    @Test func failedPauseRetriesExactPendingBoundary() async throws {
        let model = await loadedModel()
        model.startRecording()
        await model.waitForIdle()
        await repository.failNext()
        model.pause()
        await model.waitForIdle()
        let pending = try #require(model.pendingEvent)
        #expect(pending.kind == .pause)
        #expect(model.acceptingEvents == false)
        #expect(model.errorMessage != nil)
        model.addApplicationSample()
        model.resume()
        #expect(model.pendingEvent == pending)
        model.retry()
        await model.waitForIdle()
        let attempts = await repository.attempts
        #expect(Array(attempts.suffix(2)) == [pending, pending])
        #expect(model.current?.status == .paused)
        #expect(model.pendingEvent == nil)
        #expect(model.errorMessage == nil)
        #expect(model.acceptingEvents == false)
    }

    @Test(arguments: [false, true])
    func retryOfFailedStartOrSampleRequiresExplicitResume(failSample: Bool) async throws {
        let model = await loadedModel()
        if failSample {
            model.startRecording()
            await model.waitForIdle()
        }
        await repository.failNext()
        if failSample { model.addApplicationSample() } else { model.startRecording() }
        await model.waitForIdle()
        let pending = try #require(model.pendingEvent)
        #expect(model.acceptingEvents == false)
        model.retry()
        await model.waitForIdle()
        let current = try #require(model.current)
        #expect(current.status == .interrupted)
        #expect(current.intervals.last?.interrupted == true)
        #expect(current.events.last?.kind == .interrupt)
        #expect(current.events.filter { $0.id == pending.id }.count == 1)
        #expect(model.acceptingEvents == false)
        #expect(model.pendingEvent == nil)
        let attempted = await repository.attempts.filter { $0.id == pending.id }
        #expect(attempted == [pending, pending])
        model.resume()
        await model.waitForIdle()
        #expect(model.current?.status == .recording)
        #expect(model.current?.activeIntervalID != pending.intervalID)
        #expect(model.acceptingEvents)
    }

    @Test(.timeLimit(.minutes(1)))
    func shutdownDrainsHeldCommitBeforeClosingRepository() async throws {
        let model = await loadedModel()
        model.startRecording()
        await model.waitForIdle()
        await repository.holdNextCommit()
        model.addNoteSample()
        await repository.waitUntilCommitHeld()
        let pending = try #require(model.pendingEvent)
        var shutdownTask: Task<Bool, Never>?
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            shutdownTask = Task { @MainActor in
                started.resume()
                return await model.shutdown()
            }
        }
        let shutdown = try #require(shutdownTask)
        #expect(model.acceptingEvents == false)
        #expect(await repository.closeCount == 0)
        model.addAgentSample()
        #expect(model.pendingEvent == pending)
        await repository.releaseCommit()
        #expect(await shutdown.value)
        #expect(await repository.closeCount == 1)
        let saved = try #require(try await repository.load().first)
        #expect(saved.events.map(\.kind) == [.start, .note, .interrupt])
        #expect(saved.status == .interrupted)
        #expect(model.canAct == false)
        #expect(await model.shutdown())
        #expect(await repository.closeCount == 1)
    }

    @Test func shutdownRefusesQuitWhenPendingBoundaryCannotSave() async throws {
        let model = await loadedModel()
        model.startRecording()
        await model.waitForIdle()
        await repository.failNext()
        #expect(await model.shutdown() == false)
        let pending = try #require(model.pendingEvent)
        #expect(pending.kind == .interrupt)
        #expect(await repository.closeCount == 0)
        #expect(model.acceptingEvents == false)
        #expect(await model.shutdown() == false)
        #expect(model.pendingEvent == pending)
        model.retry()
        await model.waitForIdle()
        #expect(model.current?.status == .interrupted)
        #expect(await model.shutdown())
        #expect(await repository.closeCount == 1)
    }

    @Test func restoredCrashHistoryIsInterruptedWithoutAuthorizingIntake() async throws {
        let fixture = RecordingSnapshotFixture()
        let saved = try fixture.started()
        let store = RecordingModelRepositoryFixture(snapshots: [saved])
        let model = RecordingModel(repository: store, localScopeID: saved.localScopeID, stamp: clock.stamp)
        model.load()
        await model.waitForIdle()
        #expect(model.isLoaded)
        #expect(model.current?.id == saved.id)
        #expect(model.current?.status == .interrupted)
        #expect(model.current?.intervals.first?.end == nil)
        #expect(model.current?.intervals.first?.committedDuration == nil)
        #expect(model.acceptingEvents == false)
        model.load()
        await model.waitForIdle()
        #expect(await store.attempts.count == 1)
        model.resume()
        await model.waitForIdle()
        #expect(model.acceptingEvents)
        #expect(try await store.load().first?.events.map(\.kind) == [.start, .interrupt, .resume])
    }

    @Test func scopeSwitchRequiresFinishingAndDoesNotStartNewScope() async {
        let model = await loadedModel()
        model.startRecording()
        await model.waitForIdle()
        #expect(await model.switchScope(to: "second-workspace") == false)
        #expect(model.localScopeID == "synthetic-default")
        model.pause()
        await model.waitForIdle()
        #expect(await model.switchScope(to: "second-workspace") == false)
        model.finish()
        await model.waitForIdle()
        #expect(await model.switchScope(to: "second-workspace"))
        #expect(model.localScopeID == "second-workspace")
        #expect(model.recordings.isEmpty)
        #expect(model.acceptingEvents == false)
        #expect(await model.switchScope(to: "synthetic-default"))
        #expect(model.recordings.count == 1)
        #expect(model.recordings.first?.status == .finished)
    }

    @Test func sqliteRestartPreservesCommittedSamplesAndRequiresExplicitResume() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let originalRepository = SQLiteRecordingRepository(url: fixture.url)
        let originalModel = RecordingModel(repository: originalRepository, stamp: clock.stamp)
        originalModel.load()
        await originalModel.waitForIdle()
        originalModel.startRecording()
        await originalModel.waitForIdle()
        originalModel.addApplicationSample()
        await originalModel.waitForIdle()
        let original = try #require(originalModel.current)
        #expect(original.events.map(\.kind) == [.start, .application])
        // Closing storage directly simulates a process loss without a graceful boundary.
        await originalRepository.close()

        let restartedClock = RecordingModelClockFixture()
        let restartedRepository = SQLiteRecordingRepository(url: fixture.url)
        let restartedModel = RecordingModel(repository: restartedRepository, stamp: restartedClock.stamp)
        restartedModel.load()
        await restartedModel.waitForIdle()
        let recovered = try #require(restartedModel.current)
        #expect(recovered.id == original.id)
        #expect(Array(recovered.events.prefix(2)) == original.events)
        #expect(recovered.status == .interrupted)
        #expect(recovered.intervals.first?.end == nil)
        #expect(recovered.intervals.first?.committedDuration == nil)
        #expect(restartedModel.acceptingEvents == false)
        #expect(recovered.events.last?.stamp.processID != original.events.first?.stamp.processID)

        restartedModel.resume()
        await restartedModel.waitForIdle()
        #expect(restartedModel.acceptingEvents)
        #expect(restartedModel.current?.activeIntervalID != original.activeIntervalID)
        restartedModel.finish()
        await restartedModel.waitForIdle()
        let finished = try #require(restartedModel.recordings.first)
        #expect(finished.status == .finished)
        #expect(finished.events.map(\.kind) == [.start, .application, .interrupt, .resume, .finish])
        #expect(finished.intervals.map(\.committedDuration) == [nil, 1])
        #expect(await restartedModel.shutdown())

        let verificationRepository = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await verificationRepository.load() == [finished])
        await verificationRepository.close()
    }
}
