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
        model.tasks.createRecordingTask(title: "  Review capture  ")
        await model.waitForIdle()
        let task = try #require(model.tasks.taskAttribution.tasks.first)
        #expect(task.title == "Review capture")
        #expect(model.tasks.canSelectRecordingTask == false)

        for _ in 0..<2 {
            model.startRecording()
            await model.waitForIdle()
            #expect(model.tasks.activeTaskTitle == "Unassigned")
            model.tasks.selectRecordingTask(task.id)
            await model.waitForIdle()
            model.addApplicationSample()
            await model.waitForIdle()
            model.addAgentSample()
            await model.waitForIdle()
            let current = try #require(model.current)
            let app = try #require(current.events.first { $0.kind == .application })
            let agent = try #require(current.events.first { $0.kind == .agentCompletion })
            #expect(model.tasks.taskAttribution.taskID(for: app) == task.id)
            #expect(model.tasks.taskAttribution.taskID(for: agent) == nil)
            model.tasks.selectRecordingTask(nil)
            await model.waitForIdle()
            #expect(model.tasks.activeTaskTitle == "Unassigned")
            model.pause()
            await model.waitForIdle()
            #expect(model.tasks.canSelectRecordingTask == false)
            model.resume()
            await model.waitForIdle()
            #expect(model.tasks.activeTaskTitle == "Unassigned")
            model.finish()
            await model.waitForIdle()
        }
        #expect(model.recordings.count == 2)
        #expect(model.tasks.taskAttribution.tasks == [task])
        #expect(Set(model.tasks.taskAttribution.selections.map(\.recordingID)).count == 2)
        #expect(await model.shutdown())

        let reopened = RecordingModel(repository: SQLiteRecordingRepository(url: fixture.url))
        reopened.load()
        await reopened.waitForIdle()
        #expect(reopened.tasks.taskAttribution.tasks == [task])
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
        model.tasks.createRecordingTask(title: "Fix persistence")
        await model.waitForIdle()
        let task = try #require(model.tasks.taskAttribution.tasks.first)
        model.startRecording()
        await model.waitForIdle()
        model.addAgentSample()
        await model.waitForIdle()
        model.finish()
        await model.waitForIdle()
        let original = try #require(model.selected)
        let event = try #require(original.events.first { $0.kind == .agentCompletion })
        model.tasks.correctRecordingTask(event, assignment: .task(task.id))
        await model.waitForIdle()
        let correction = try #require(model.tasks.taskAttribution.head(eventID: event.id))
        #expect(model.tasks.taskTitle(for: event) == task.title)
        #expect(model.recordings == [original])
        #expect(model.acceptingEvents == false)
        #expect(await model.shutdown())

        let reopened = RecordingModel(
            repository: SQLiteRecordingRepository(url: fixture.url), stamp: RecordingModelClockFixture().stamp)
        reopened.load()
        await reopened.waitForIdle()
        #expect(reopened.tasks.taskAttribution.head(eventID: event.id) == correction)
        #expect(reopened.tasks.taskTitle(for: event) == task.title)
        reopened.tasks.undoRecordingTask(correction)
        await reopened.waitForIdle()
        let undo = try #require(reopened.tasks.taskAttribution.head(eventID: event.id))
        #expect(undo.command.undoesOperationID == correction.id)
        #expect(undo.command.expectedHeadID == correction.id)
        #expect(reopened.tasks.taskTitle(for: event) == "Unassigned")
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
        model.tasks.correctRecordingTask(event, assignment: .unassigned)
        await model.waitForIdle()
        #expect(model.tasks.hasPendingTaskAction)
        #expect(model.tasks.taskErrorMessage != nil)
        #expect(model.tasks.canEditTasks == false)
        #expect(model.tasks.taskAttribution.operations.count == 1)
        #expect(await model.shutdown() == false, "An unresolved command must not be silently dropped on Quit")
        #expect(await model.switchScope(to: "another-scope") == false, "A pending command cannot change scopes")
        model.tasks.retryTaskAction()
        await model.waitForIdle()
        let attempts = await repository.corrections
        #expect(attempts.count == 2)
        #expect(attempts.first == attempts.last)
        #expect(model.tasks.hasPendingTaskAction == false)
        #expect(model.tasks.taskErrorMessage == nil)
        #expect(model.tasks.taskAttribution.operations.count == 1)
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
        model.tasks.correctRecordingTask(event, assignment: .unassigned)
        await model.waitForIdle()
        #expect(model.tasks.hasPendingTaskAction)
        #expect(
            model.tasks.taskErrorMessage
                == RecordingAttributionError.staleHead(currentHeadID: winner.id).localizedDescription
        )
        #expect(model.tasks.taskAttribution.operations == [winner], "Refresh exposes the winning correction")
        model.tasks.retryTaskAction()
        await model.waitForIdle()
        #expect(model.tasks.hasPendingTaskAction)
        #expect(model.tasks.taskAttribution.operations == [winner], "Retry retains the original stale head")
        model.tasks.discardTaskAction()
        await model.waitForIdle()
        #expect(model.tasks.taskErrorMessage == nil)
        #expect(model.tasks.canEditTasks)
        model.tasks.correctRecordingTask(event, assignment: .unassigned)
        await model.waitForIdle()
        #expect(model.tasks.taskAttribution.operations.count == 2)
        #expect(model.tasks.taskAttribution.head(eventID: event.id)?.command.expectedHeadID == winner.id)
        #expect(await model.shutdown())
    }

    @Test
    func scopeSwitchClearsTaskProjectionBeforeReloadAndKeepsScopesIsolated() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let base = SQLiteRecordingRepository(url: fixture.url)
        let firstTask = LocalTask(localScopeID: "first", title: "First scope", createdAt: .now)
        let secondTask = LocalTask(localScopeID: "second", title: "Second scope", createdAt: .now)
        _ = try await base.createTask(firstTask)
        _ = try await base.createTask(secondTask)
        let repository = TaskModelAcknowledgementFixture(base: base)
        let model = RecordingModel(
            repository: repository, localScopeID: "first", stamp: RecordingModelClockFixture().stamp)
        model.load()
        await model.waitForIdle()
        #expect(model.tasks.taskAttribution.tasks == [firstTask])
        model.startRecording()
        await model.waitForIdle()
        model.addAgentSample()
        await model.waitForIdle()
        model.finish()
        await model.waitForIdle()
        let event = try #require(model.selected?.events.first { $0.kind == .agentCompletion })
        model.tasks.correctRecordingTask(event, assignment: .task(firstTask.id))
        await model.waitForIdle()
        let firstAttribution = model.tasks.taskAttribution

        await repository.holdNextTaskLoad()
        let switching = Task { await model.switchScope(to: "second") }
        await repository.waitUntilTaskLoadHeld()
        #expect(model.localScopeID == "second")
        #expect(model.tasks.taskAttribution.tasks.isEmpty)
        #expect(model.tasks.taskAttribution.operations.isEmpty)
        #expect(model.tasks.tasksLoaded == false)
        #expect(model.tasks.canEditTasks == false)
        model.tasks.createRecordingTask(title: "Must not save while switching")
        #expect(model.tasks.hasPendingTaskAction == false)
        await repository.releaseTaskLoad()
        #expect(await switching.value)
        #expect(model.tasks.taskAttribution.tasks == [secondTask])
        #expect(model.tasks.taskAttribution.operations.isEmpty)
        #expect(model.tasks.canEditTasks)
        model.tasks.correctRecordingTask(event, assignment: .task(secondTask.id))
        #expect(model.tasks.hasPendingTaskAction == false, "An old scope's evidence cannot be corrected here")

        #expect(await model.switchScope(to: "first"))
        #expect(model.tasks.taskAttribution == firstAttribution)
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
        model.tasks.retryTaskAction()
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
