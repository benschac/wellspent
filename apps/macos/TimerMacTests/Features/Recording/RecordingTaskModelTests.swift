import Foundation
import Testing

@testable import TimerMac

@MainActor
struct RecordingTaskModelTests {
    @Test
    func taskSpansRecordingsWhileNewIntervalsAndAgentEvidenceRemainUnassigned() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let model = RecordingModel(
            repository: SQLiteRecordingRepository(url: fixture.url), stamp: RecordingModelClockFixture().stamp)
        model.load()
        await model.waitForIdle()
        model.createRecordingTask(title: "  Review capture  ")
        await model.waitForIdle()
        let task = try #require(model.taskAttribution.tasks.first)
        #expect(task.title == "Review capture")
        #expect(model.canSelectRecordingTask == false)

        for _ in 0..<2 {
            model.startRecording()
            await model.waitForIdle()
            #expect(model.activeTaskTitle == "Unassigned")
            model.selectRecordingTask(task.id)
            await model.waitForIdle()
            model.addApplicationSample()
            await model.waitForIdle()
            model.addAgentSample()
            await model.waitForIdle()
            let current = try #require(model.current)
            let app = try #require(current.events.first { $0.kind == .application })
            let agent = try #require(current.events.first { $0.kind == .agentCompletion })
            #expect(model.taskAttribution.taskID(for: app) == task.id)
            #expect(model.taskAttribution.taskID(for: agent) == nil)
            model.selectRecordingTask(nil)
            await model.waitForIdle()
            #expect(model.activeTaskTitle == "Unassigned")
            model.pause()
            await model.waitForIdle()
            #expect(model.canSelectRecordingTask == false)
            model.resume()
            await model.waitForIdle()
            #expect(model.activeTaskTitle == "Unassigned")
            model.finish()
            await model.waitForIdle()
        }
        #expect(model.recordings.count == 2)
        #expect(model.taskAttribution.tasks == [task])
        #expect(Set(model.taskAttribution.selections.map(\.recordingID)).count == 2)
        #expect(await model.shutdown())

        let reopened = RecordingModel(repository: SQLiteRecordingRepository(url: fixture.url))
        reopened.load()
        await reopened.waitForIdle()
        #expect(reopened.taskAttribution.tasks == [task])
        #expect(reopened.recordings.count == 2)
        #expect(await reopened.shutdown())
    }

    @Test
    func finishedCorrectionAndUndoSurviveReopenWithoutChangingOriginalEvidenceOrAuthorization() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let model = RecordingModel(
            repository: SQLiteRecordingRepository(url: fixture.url), stamp: RecordingModelClockFixture().stamp)
        model.load()
        await model.waitForIdle()
        model.createRecordingTask(title: "Fix persistence")
        await model.waitForIdle()
        let task = try #require(model.taskAttribution.tasks.first)
        model.startRecording()
        await model.waitForIdle()
        model.addAgentSample()
        await model.waitForIdle()
        model.finish()
        await model.waitForIdle()
        let original = try #require(model.selected)
        let event = try #require(original.events.first { $0.kind == .agentCompletion })
        model.correctRecordingTask(event, assignment: .task(task.id))
        await model.waitForIdle()
        let correction = try #require(model.taskAttribution.head(eventID: event.id))
        #expect(model.taskTitle(for: event) == task.title)
        #expect(model.recordings == [original])
        #expect(model.acceptingEvents == false)
        #expect(await model.shutdown())

        let reopened = RecordingModel(
            repository: SQLiteRecordingRepository(url: fixture.url), stamp: RecordingModelClockFixture().stamp)
        reopened.load()
        await reopened.waitForIdle()
        #expect(reopened.taskAttribution.head(eventID: event.id) == correction)
        #expect(reopened.taskTitle(for: event) == task.title)
        reopened.undoRecordingTask(correction)
        await reopened.waitForIdle()
        let undo = try #require(reopened.taskAttribution.head(eventID: event.id))
        #expect(undo.command.undoesOperationID == correction.id)
        #expect(undo.command.expectedHeadID == correction.id)
        #expect(reopened.taskTitle(for: event) == "Unassigned")
        #expect(reopened.recordings == [original])
        #expect(reopened.acceptingEvents == false)
        #expect(await reopened.shutdown())

        let stored = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await stored.load() == [original])
        #expect(
            try await stored.loadTaskAttribution(localScopeID: original.localScopeID).operations == [correction, undo])
        await stored.close()
    }

    @Test
    func lostCorrectionAcknowledgementRetainsExactCommandAndRetriesOnce() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = TaskModelAcknowledgementFixture(base: SQLiteRecordingRepository(url: fixture.url))
        let model = RecordingModel(repository: repository, stamp: RecordingModelClockFixture().stamp)
        model.load()
        await model.waitForIdle()
        model.startRecording()
        await model.waitForIdle()
        model.addAgentSample()
        await model.waitForIdle()
        model.finish()
        await model.waitForIdle()
        let event = try #require(model.selected?.events.first { $0.kind == .agentCompletion })
        await repository.loseNextAcknowledgement()
        model.correctRecordingTask(event, assignment: .unassigned)
        await model.waitForIdle()
        #expect(model.hasPendingTaskAction)
        #expect(model.taskErrorMessage != nil)
        #expect(model.canEditTasks == false)
        #expect(model.taskAttribution.operations.count == 1)
        #expect(await model.shutdown() == false, "An unresolved command must not be silently dropped on Quit")
        model.retryTaskAction()
        await model.waitForIdle()
        let attempts = await repository.corrections
        #expect(attempts.count == 2)
        #expect(attempts.first == attempts.last)
        #expect(model.hasPendingTaskAction == false)
        #expect(model.taskErrorMessage == nil)
        #expect(model.taskAttribution.operations.count == 1)
        #expect(await model.shutdown())
    }

    @Test
    func staleCorrectionRemainsVisibleAndCannotOverwriteUntilExplicitReloadAndNewCommand() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let model = RecordingModel(repository: repository, stamp: RecordingModelClockFixture().stamp)
        model.load()
        await model.waitForIdle()
        model.startRecording()
        await model.waitForIdle()
        model.addAgentSample()
        await model.waitForIdle()
        model.finish()
        await model.waitForIdle()
        let event = try #require(model.selected?.events.first { $0.kind == .agentCompletion })
        let winner = try await repository.correctTaskAttribution(
            .init(
                localScopeID: event.localScopeID, recordingID: event.recordingID, eventID: event.id,
                assignment: .unassigned, createdAt: event.stamp.wall))
        model.correctRecordingTask(event, assignment: .unassigned)
        await model.waitForIdle()
        #expect(model.hasPendingTaskAction)
        #expect(
            model.taskErrorMessage == RecordingAttributionError.staleHead(currentHeadID: winner.id).localizedDescription
        )
        #expect(model.taskAttribution.operations == [winner], "Refresh exposes the winning correction")
        model.retryTaskAction()
        await model.waitForIdle()
        #expect(model.hasPendingTaskAction)
        #expect(model.taskAttribution.operations == [winner], "Retry retains the original stale head")
        model.discardTaskAction()
        await model.waitForIdle()
        #expect(model.taskErrorMessage == nil)
        #expect(model.canEditTasks)
        model.correctRecordingTask(event, assignment: .unassigned)
        await model.waitForIdle()
        #expect(model.taskAttribution.operations.count == 2)
        #expect(model.taskAttribution.head(eventID: event.id)?.command.expectedHeadID == winner.id)
        #expect(await model.shutdown())
    }

    @Test
    func taskReloadDrainsQueuedForegroundObservationAndTimerPauseInReceiptOrder() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = TaskModelAcknowledgementFixture(base: SQLiteRecordingRepository(url: fixture.url))
        let model = RecordingModel(repository: repository, stamp: RecordingModelClockFixture().stamp)
        model.load()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        await repository.holdNextTaskLoad()
        model.retryTaskAction()
        await repository.waitUntilTaskLoadHeld()
        #expect(model.isBusy)
        model.recordForegroundApplication(nil)
        model.pauseFromTimer()
        #expect(model.acceptingEvents == false, "Pause revokes capture immediately during the reload")
        await repository.releaseTaskLoad()
        await model.waitForIdle()
        let recording = try #require(model.current)
        #expect(recording.events.map(\.kind) == [.start, .application, .pause])
        #expect(recording.status == .paused)
        #expect(model.acceptingEvents == false)
        #expect(model.pendingEvent == nil)
        #expect(await model.shutdown())
    }
}

private actor TaskModelAcknowledgementFixture: RecordingRepository {
    let base: SQLiteRecordingRepository
    private var losesAcknowledgement = false
    private var holdsNextLoad = false
    private var heldLoad: CheckedContinuation<Void, Never>?
    private var loadWaiter: CheckedContinuation<Void, Never>?
    private(set) var corrections: [RecordingAttributionCommand] = []

    init(base: SQLiteRecordingRepository) { self.base = base }
    func loseNextAcknowledgement() { losesAcknowledgement = true }
    func holdNextTaskLoad() { holdsNextLoad = true }
    func waitUntilTaskLoadHeld() async {
        if heldLoad != nil { return }
        await withCheckedContinuation { loadWaiter = $0 }
    }
    func releaseTaskLoad() {
        heldLoad?.resume()
        heldLoad = nil
    }
    func load() async throws -> [RecordingSnapshot] { try await base.load() }
    func commit(_ event: RecordingEvent) async throws -> RecordingSnapshot { try await base.commit(event) }
    func delete(_ recordingID: UUID, localScopeID: String) async throws {
        try await base.delete(recordingID, localScopeID: localScopeID)
    }
    func loadTaskAttribution(localScopeID: String) async throws -> RecordingTaskAttribution {
        if holdsNextLoad {
            holdsNextLoad = false
            await withCheckedContinuation { continuation in
                heldLoad = continuation
                loadWaiter?.resume()
                loadWaiter = nil
            }
        }
        return try await base.loadTaskAttribution(localScopeID: localScopeID)
    }
    func correctTaskAttribution(_ command: RecordingAttributionCommand) async throws -> RecordingAttributionOperation {
        corrections.append(command)
        let result = try await base.correctTaskAttribution(command)
        if losesAcknowledgement {
            losesAcknowledgement = false
            throw RecordingError.storage(13)
        }
        return result
    }
    func close() async { await base.close() }
}
