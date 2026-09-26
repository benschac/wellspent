import Foundation
import Observation

/// Owns task interpretation and exact-command retries; RecordingModel serializes all work.
@MainActor
@Observable
final class RecordingTaskModel {
    @ObservationIgnored private weak var recording: RecordingModel?
    @ObservationIgnored private let repository: any RecordingRepository
    @ObservationIgnored private let stamp: @MainActor () -> RecordingEvent.Stamp

    init(
        recording: RecordingModel, repository: any RecordingRepository,
        stamp: @escaping @MainActor () -> RecordingEvent.Stamp
    ) {
        self.recording = recording
        self.repository = repository
        self.stamp = stamp
    }

    private(set) var taskAttribution = RecordingTaskAttribution()
    private(set) var taskErrorMessage: String?
    private(set) var tasksLoaded = false
    private var pendingTaskAction: TaskAction?

    private enum TaskAction {
        case create(LocalTask)
        case select(RecordingTaskSelection)
        case correct(RecordingAttributionCommand)
    }

    var hasPendingTaskAction: Bool { pendingTaskAction != nil }
    var canEditTasks: Bool { recording?.canConfigureRecording == true && tasksLoaded && pendingTaskAction == nil }
    var canSelectRecordingTask: Bool {
        canEditTasks && recording?.acceptingEvents == true && recording?.current?.activeIntervalID != nil
    }
    var activeTaskTitle: String {
        guard let current = recording?.current, let intervalID = current.activeIntervalID else {
            return "Unassigned · select while recording"
        }
        return titleForTask(taskAttribution.selectedTaskID(recordingID: current.id, intervalID: intervalID))
    }

    func titleForTask(_ id: UUID?) -> String {
        taskAttribution.tasks.first(where: { $0.id == id })?.title ?? "Unassigned"
    }

    func taskTitle(for event: RecordingEvent) -> String {
        titleForTask(taskAttribution.taskID(for: event))
    }

    func assignmentTitle(_ assignment: RecordingTaskAssignment) -> String {
        switch assignment {
        case .task(let id): titleForTask(id)
        case .unassigned: "Unassigned"
        case .automatic: "Original assignment"
        }
    }

    func createRecordingTask(title: String) {
        guard canEditTasks, let recording else { return }
        let task = LocalTask(
            localScopeID: recording.localScopeID, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            createdAt: stamp().wall)
        pendingTaskAction = .create(task)
        recording.runTaskAction { await self.commitTaskAction() }
    }

    func selectRecordingTask(_ taskID: UUID?) {
        guard canSelectRecordingTask, let recording, let current = recording.current,
            let intervalID = current.activeIntervalID
        else { return }
        let selection = RecordingTaskSelection(
            localScopeID: recording.localScopeID, recordingID: current.id, intervalID: intervalID, taskID: taskID,
            stamp: stamp(),
            expectedHeadID: taskAttribution.selectionHead(recordingID: current.id, intervalID: intervalID)?.id)
        pendingTaskAction = .select(selection)
        recording.runTaskAction { await self.commitTaskAction() }
    }

    func correctRecordingTask(_ event: RecordingEvent, assignment: RecordingTaskAssignment) {
        guard canEditTasks, let recording, event.localScopeID == recording.localScopeID else { return }
        let command = RecordingAttributionCommand(
            localScopeID: recording.localScopeID, recordingID: event.recordingID, eventID: event.id,
            expectedHeadID: taskAttribution.head(eventID: event.id)?.id, assignment: assignment, createdAt: stamp().wall
        )
        pendingTaskAction = .correct(command)
        recording.runTaskAction { await self.commitTaskAction() }
    }

    func undoRecordingTask(_ operation: RecordingAttributionOperation) {
        guard canEditTasks, let recording else { return }
        pendingTaskAction = .correct(taskAttribution.undoCommand(for: operation, at: stamp().wall))
        recording.runTaskAction { await self.commitTaskAction() }
    }

    func retryTaskAction() {
        guard let recording, recording.canAct else { return }
        recording.runTaskAction {
            if self.pendingTaskAction != nil {
                await self.commitTaskAction()
            } else {
                await self.reloadTaskAttribution()
            }
        }
    }

    func discardTaskAction() {
        guard let recording, recording.canAct else { return }
        pendingTaskAction = nil
        recording.runTaskAction {
            await self.reloadTaskAttribution()
        }
    }

    func reloadTaskAttribution() async {
        guard let recording else { return }
        do {
            taskAttribution = try await repository.loadTaskAttribution(localScopeID: recording.localScopeID)
            tasksLoaded = true
            taskErrorMessage = nil
        } catch {
            tasksLoaded = false
            taskErrorMessage = error.localizedDescription
        }
    }

    private func commitTaskAction() async {
        guard let action = pendingTaskAction, let recording else { return }
        do {
            // A background save can fail while this exact command is waiting for its slot.
            // Keep the command retryable until recording recovery has completed.
            guard recording.errorMessage == nil, recording.pendingEvent == nil else {
                throw RecordingError.invalidTransition
            }
            switch action {
            case .create(let task): _ = try await repository.createTask(task)
            case .select(let selection): _ = try await repository.selectTask(selection)
            case .correct(let command): _ = try await repository.correctTaskAttribution(command)
            }
            taskAttribution = try await repository.loadTaskAttribution(localScopeID: recording.localScopeID)
            tasksLoaded = true
            pendingTaskAction = nil
            taskErrorMessage = nil
        } catch {
            // Keep the exact command, including its expected head, for an idempotent retry.
            // A refreshed head is never silently substituted into the user's failed command.
            let message = error.localizedDescription
            await reloadTaskAttribution()
            taskErrorMessage = message
        }
    }

    /// Called only after the recording owner has excluded active or pending work.
    func resetForScopeChange() {
        taskAttribution = RecordingTaskAttribution()
        tasksLoaded = false
        taskErrorMessage = nil
    }
}
