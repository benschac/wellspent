import Foundation
import Observation

/// Owns synthetic intake authorization. Views only request actions and render committed history.
@MainActor
@Observable
final class RecordingModel {
    private(set) var recordings: [RecordingSnapshot] = []
    private(set) var localScopeID: String
    private(set) var isLoaded = false
    private(set) var isBusy = false
    private(set) var acceptingEvents = false
    private(set) var errorMessage: String?
    private(set) var pendingEvent: RecordingEvent?
    var selectedID: UUID?

    @ObservationIgnored private let repository: any RecordingRepository
    @ObservationIgnored private let stamp: @MainActor () -> RecordingEvent.Stamp
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var isShuttingDown = false
    @ObservationIgnored private var isClosed = false
    @ObservationIgnored private var needsRecovery = true

    init(
        repository: any RecordingRepository = SQLiteRecordingRepository(), localScopeID: String = "synthetic-default",
        stamp: (@MainActor () -> RecordingEvent.Stamp)? = nil
    ) {
        self.repository = repository
        self.localScopeID = localScopeID
        let processID = UUID()
        self.stamp = stamp ?? { .init(wall: .now, uptime: ProcessInfo.processInfo.systemUptime, processID: processID) }
    }

    var current: RecordingSnapshot? { recordings.first(where: { $0.status != .finished }) }
    var selected: RecordingSnapshot? { recordings.first(where: { $0.id == selectedID }) ?? current ?? recordings.first }
    var canAct: Bool { isLoaded && !isBusy && pendingEvent == nil && !isClosed && !isShuttingDown && !needsRecovery }
    var saveStatus: String {
        if pendingEvent != nil, errorMessage != nil { return "Stopped — action not confirmed saved" }
        if isBusy { return "Saving or loading local history…" }
        if errorMessage != nil { return "Local history unavailable" }
        if !isLoaded { return "Local history not loaded" }
        return "Saved on this Mac · No upload"
    }

    func load() {
        guard !isLoaded, !isBusy, !isClosed, !isShuttingDown, pendingEvent == nil else { return }
        run { await self.restore() }
    }

    func startRecording() {
        guard canAct, current == nil else { return }
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: UUID(), intervalID: UUID(), kind: .start, stamp: stamp(),
                text: "Synthetic workflow sample"))
    }

    func pause() { transition(.pause, text: "Manual pause — explicit Resume required") }
    func resume() { transition(.resume, text: "Explicit resume — new interval") }
    func finish() { transition(.finish, text: "Recording finished") }
    func simulateGap() { transition(.suspend, text: "Synthetic sleep / unavailable session — coverage gap") }

    func addApplicationSample() { addSample(.application, text: "Sample Editor became foreground") }
    func addAgentSample() {
        addSample(.agentCompletion, text: "Sample agent reported a tool completion; outcome unverified")
    }
    func addNoteSample() { addSample(.note, text: "Sample manual note: review the next step") }

    func retry() {
        guard !isBusy, !isClosed, !isShuttingDown else { return }
        if pendingEvent != nil {
            run { await self.commitPending() }
        } else {
            isLoaded = false
            load()
        }
    }

    func waitForIdle() async { await operation?.value }

    /// Scope changes never retarget a queued action. Finish the old scope before switching.
    func switchScope(to scope: String) async -> Bool {
        guard canAct, current == nil, !scope.isEmpty, scope.utf8.count <= 200 else { return false }
        localScopeID = scope
        recordings = []
        selectedID = nil
        isLoaded = false
        load()
        await waitForIdle()
        return isLoaded && errorMessage == nil
    }

    /// Ordinary Quit is refused if a pending boundary cannot be saved. Crash recovery is separate.
    func shutdown() async -> Bool {
        guard !isClosed else { return true }
        isShuttingDown = true
        acceptingEvents = false
        await operation?.value
        guard pendingEvent == nil else {
            isShuttingDown = false
            return false
        }
        if let current, current.status != .interrupted {
            pendingEvent = RecordingEvent(
                localScopeID: localScopeID, recordingID: current.id, intervalID: current.intervals.last?.id,
                kind: .interrupt, stamp: stamp(), text: "App closed — explicit Resume required; final coverage unknown")
            await commitPending()
            guard pendingEvent == nil else {
                isShuttingDown = false
                return false
            }
        }
        await repository.close()
        isClosed = true
        return true
    }

    private func transition(_ kind: RecordingEvent.Kind, text: String) {
        guard canAct, let current else { return }
        acceptingEvents = false
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: current.id,
                intervalID: kind == .resume ? UUID() : current.intervals.last?.id, kind: kind, stamp: stamp(),
                text: text))
    }

    private func addSample(_ kind: RecordingEvent.Kind, text: String) {
        guard canAct, acceptingEvents, let current, let intervalID = current.activeIntervalID else { return }
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: current.id, intervalID: intervalID, kind: kind, stamp: stamp(),
                text: text))
    }

    private func submit(_ event: RecordingEvent) {
        pendingEvent = event
        run { await self.commitPending() }
    }

    private func run(_ action: @escaping @MainActor () async -> Void) {
        isBusy = true
        operation = Task {
            await action()
            self.isBusy = false
        }
    }

    private func restore() async {
        acceptingEvents = false
        do {
            let all = try await repository.load()
            // Recovery spans all local scopes, so an abandoned scope cannot keep collecting.
            for saved in all where saved.status != .finished && saved.status != .interrupted {
                let event = RecordingEvent(
                    localScopeID: saved.localScopeID, recordingID: saved.id, intervalID: saved.intervals.last?.id,
                    kind: .interrupt, stamp: stamp(),
                    text: "Relaunch — interruption time unknown; explicit Resume required")
                pendingEvent = event
                _ = try await repository.commit(event)
                pendingEvent = nil
            }
            recordings = try await repository.load().filter { $0.localScopeID == localScopeID }
            isLoaded = true
            needsRecovery = false
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func commitPending() async {
        guard let event = pendingEvent else { return }
        let wasStoppedByFailure = errorMessage != nil
        do {
            let saved = try await repository.commit(event)
            if saved.localScopeID == localScopeID {
                if let index = recordings.firstIndex(where: { $0.id == saved.id }) {
                    recordings[index] = saved
                } else {
                    recordings.insert(saved, at: 0)
                }
                selectedID = saved.id
            }
            pendingEvent = nil
            errorMessage = nil
            if needsRecovery {
                await restore()
            } else if wasStoppedByFailure && saved.status == .recording {
                // A save retry never silently restarts intake after a storage failure.
                pendingEvent = RecordingEvent(
                    localScopeID: saved.localScopeID, recordingID: saved.id, intervalID: saved.activeIntervalID,
                    kind: .interrupt, stamp: stamp(),
                    text: "Storage failure — coverage unknown; explicit Resume required")
                await commitPending()
            } else {
                acceptingEvents = saved.status == .recording && !isShuttingDown
            }
        } catch {
            acceptingEvents = false
            errorMessage = error.localizedDescription
        }
    }
}
