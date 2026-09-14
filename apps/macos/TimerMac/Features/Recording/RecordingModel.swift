import Foundation
import Observation

/// Owns local intake authorization. Views only request actions and render committed history.
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
    @ObservationIgnored private var queuedEvents: [RecordingEvent] = []
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var isShuttingDown = false
    @ObservationIgnored private var isClosed = false
    @ObservationIgnored private var needsRecovery = true
    @ObservationIgnored var captureStateDidChange: (@MainActor () -> Void)?
    @ObservationIgnored lazy var codex = LocalCodexIntakeModel(recording: self)
    @ObservationIgnored lazy var harness = LocalHarnessModel(recording: self)

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
    var canCaptureForegroundApplications: Bool {
        isLoaded && !isClosed && !isShuttingDown && !needsRecovery && errorMessage == nil
            && acceptingEvents && current?.capturesForegroundApplications == true
    }
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

    func startForegroundApplicationRecording() {
        guard canAct, current == nil else { return }
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: UUID(), intervalID: UUID(), kind: .start, stamp: stamp(),
                text: "Foreground application recording", captureConfiguration: .foregroundApplicationOnly))
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

    /// The monitor calls this only after a user started a foreground-only recording.
    func recordForegroundApplication(_ identity: RecordingEvent.ApplicationIdentity?) {
        guard canCaptureForegroundApplications, let current, let intervalID = current.activeIntervalID else { return }
        let text: String
        if let identity {
            text = "Foreground application: \(identity.disclosure)"
        } else {
            text = "Foreground application identity unavailable; no window or document data was collected"
        }
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: current.id, intervalID: intervalID, kind: .application,
                stamp: stamp(), text: text, applicationIdentity: identity))
    }

    /// A verified sleep/session loss ends coverage immediately. Return always needs the user's Resume action.
    func suspendForLifecycle(reason: String) {
        guard acceptingEvents, !isClosed, !isShuttingDown, let current,
            let intervalID = current.activeIntervalID
        else { return }
        acceptingEvents = false
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: current.id, intervalID: intervalID,
                kind: .suspend, stamp: stamp(), text: "\(reason) — coverage gap; explicit Resume required"))
        captureStateDidChange?()
    }

    func delete(_ recording: RecordingSnapshot) {
        guard canAct, recording.localScopeID == localScopeID, recording.status != .recording else { return }
        run {
            var deletionError: String?
            do {
                try await self.repository.delete(recording.id, localScopeID: self.localScopeID)
                self.recordings.removeAll { $0.id == recording.id }
                if self.selectedID == recording.id { self.selectedID = self.recordings.first?.id }
                self.errorMessage = nil
            } catch {
                deletionError = error.localizedDescription
                self.errorMessage = deletionError
                self.acceptingEvents = false
                self.captureStateDidChange?()
            }
            // Capture may enqueue observations and lifecycle boundaries during the deletion await.
            // Drain them before allowing a later user action to overtake their receipt order.
            if !self.queuedEvents.isEmpty {
                self.pendingEvent = self.queuedEvents.removeFirst()
                await self.commitPending()
            } else if deletionError != nil, let current = self.current, current.status == .recording {
                // With no queued event, commitPending has nothing to trigger its failure-gap policy.
                self.pendingEvent = RecordingEvent(
                    localScopeID: current.localScopeID, recordingID: current.id, intervalID: current.activeIntervalID,
                    kind: .interrupt, stamp: self.stamp(),
                    text: "Storage failure — coverage unknown; explicit Resume required")
                await self.commitPending()
            }
            // Successful coverage repair must not hide the failed deletion. A pending write error
            // takes priority so Retry continues to refer to that exact unsaved event.
            if self.pendingEvent == nil, let deletionError { self.errorMessage = deletionError }
        }
    }

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

    func localCodexGrants() async throws -> [CodexIntakeContract.Grant] {
        guard canAct else { throw RecordingError.invalidTransition }
        return try await repository.codexGrants()
    }

    func pairLocalCodex(senderID: String, threadID: String, endpoint: String) async throws
        -> CodexIntakeContract.PairingBundle
    {
        guard let current, let intervalID = current.activeIntervalID else {
            throw RecordingError.invalidTransition
        }
        return try await codexAction {
            try await self.repository.issueCodexGrant(
                senderID: senderID, threadID: threadID, recordingID: current.id,
                localScopeID: current.localScopeID, intervalID: intervalID,
                issuedAt: self.stamp().wall, endpoint: endpoint)
        }
    }

    func revokeLocalCodex(bindingID: UUID) async throws {
        try await codexAction { try await self.repository.revokeCodexGrant(bindingID: bindingID) }
    }

    func receiveLocalCodex(
        _ packet: CodexIntakeContract.Packet, bindingID: UUID,
        acknowledge: (@MainActor (CodexIntakeContract.Packet) async throws -> Void)? = nil
    ) async throws
        -> CodexIntakeContract.Packet
    {
        try await codexAction {
            let ack = try await self.repository.receiveCodexPacket(packet, bindingID: bindingID, stamp: self.stamp())
            self.recordings = try await self.repository.load().filter { $0.localScopeID == self.localScopeID }
            try Task.checkCancellation()
            // Keep user revocation/deletion behind the same operation until ACK delivery ends.
            // A failed/lost ACK leaves the original committed event available for an exact retry.
            try await acknowledge?(ack)
            return ack
        }
    }

    var activeHarnessInterval: LocalHarnessContract.Active? {
        guard canAct, acceptingEvents, errorMessage == nil, let current,
            let intervalID = current.activeIntervalID
        else { return nil }
        return .init(recordingID: current.id, intervalID: intervalID, localScopeID: localScopeID)
    }

    /// Admission is serialized with recording boundaries. Only an exact already-committed retry
    /// can succeed after closure/relaunch; new evidence always needs this process's active interval.
    func receiveWorkNote(
        _ packet: CodexIntakeContract.Packet, connection: LocalHarnessContract.Connection, epoch: UUID
    ) async throws -> RecordingEvent {
        let note = try LocalHarnessContract.note(packet, connection: connection)
        guard connection.localScopeID == localScopeID else { throw LocalHarnessContract.Failure.wrongScope }
        return try await codexAction {
            // Read durable history as a previous commit may have succeeded before its ACK was lost.
            let saved = try await self.repository.load()
            if let original = saved.flatMap(\.events).first(where: { $0.id == note.eventID }) {
                guard original.workNote?.exactBody == packet.body, original.localScopeID == self.localScopeID else {
                    throw LocalHarnessContract.Failure.identityConflict
                }
                self.recordings = saved.filter { $0.localScopeID == self.localScopeID }
                return original
            }
            let now = self.stamp()
            let reportedAt = try CodexIntakeContract.date(note.reportedAt)
            guard note.epoch == epoch, now.wall.timeIntervalSince(reportedAt) >= 0,
                now.wall.timeIntervalSince(reportedAt) <= 15
            else { throw LocalHarnessContract.Failure.expiredRequest }
            guard self.acceptingEvents, !self.isShuttingDown, self.errorMessage == nil,
                self.current?.id == note.recordingID, self.current?.activeIntervalID == note.intervalID,
                let interval = self.current?.intervals.last,
                reportedAt >= interval.start.wall.addingTimeInterval(-0.001)
            else { throw LocalHarnessContract.Failure.inactiveInterval }
            try Task.checkCancellation()
            let event = RecordingEvent(
                id: note.eventID, localScopeID: note.localScopeID, recordingID: note.recordingID,
                intervalID: note.intervalID, kind: .note, stamp: now, text: note.text,
                workNote: .init(exactBody: packet.body, bodyDigest: CodexIntakeContract.digest(packet.body)))
            let updated = try await self.repository.commit(event)
            if let index = self.recordings.firstIndex(where: { $0.id == updated.id }) {
                self.recordings[index] = updated
            }
            return event
        }
    }

    /// Reuse the recording operation gate so shutdown waits for intake and UI snapshots cannot
    /// overwrite each other across awaits. The repository independently enforces grant atomicity.
    private func codexAction<Value>(_ action: @escaping @MainActor () async throws -> Value) async throws -> Value {
        guard canAct else { throw RecordingError.invalidTransition }
        var result: Result<Value, Error>?
        run {
            do { result = .success(try await action()) } catch { result = .failure(error) }
            if !self.queuedEvents.isEmpty {
                self.pendingEvent = self.queuedEvents.removeFirst()
                await self.commitPending()
            }
        }
        await waitForIdle()
        guard let result else { throw RecordingError.invalidTransition }
        return try result.get()
    }

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
        await harness.stop()
        await codex.stop()
        await operation?.value
        guard pendingEvent == nil else {
            isShuttingDown = false
            harness.resumeAfterFailedShutdown()
            return false
        }
        if let current, current.status != .interrupted {
            pendingEvent = RecordingEvent(
                localScopeID: localScopeID, recordingID: current.id, intervalID: current.intervals.last?.id,
                kind: .interrupt, stamp: stamp(), text: "App closed — explicit Resume required; final coverage unknown")
            await commitPending()
            guard pendingEvent == nil else {
                isShuttingDown = false
                harness.resumeAfterFailedShutdown()
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
        if isBusy {
            queuedEvents.append(event)
            return
        }
        pendingEvent = event
        run { await self.commitPending() }
    }

    private func run(_ action: @escaping @MainActor () async -> Void) {
        isBusy = true
        operation = Task {
            await action()
            self.isBusy = false
            self.captureStateDidChange?()
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
        let wasStoppedByFailure = errorMessage != nil
        while let event = pendingEvent {
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
                if !queuedEvents.isEmpty {
                    // Keep receipt order and timestamps, including a boundary that revoked intake
                    // while this commit was suspended. Never reauthorize between queued saves.
                    pendingEvent = queuedEvents.removeFirst()
                } else if needsRecovery {
                    await restore()
                    return
                } else if wasStoppedByFailure && saved.status == .recording {
                    // Drain already-authorized events before closing the storage-failure gap.
                    pendingEvent = RecordingEvent(
                        localScopeID: saved.localScopeID, recordingID: saved.id, intervalID: saved.activeIntervalID,
                        kind: .interrupt, stamp: stamp(),
                        text: "Storage failure — coverage unknown; explicit Resume required")
                } else {
                    acceptingEvents = saved.status == .recording && !isShuttingDown
                }
            } catch {
                acceptingEvents = false
                errorMessage = error.localizedDescription
                return
            }
        }
    }
}
