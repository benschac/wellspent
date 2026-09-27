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
    private(set) var isPerformingUserAction = false
    private(set) var acceptingEvents = false {
        didSet {
            if !acceptingEvents {
                telemetry.stopReading()
                liveTelemetryWarnings.removeAll()
            }
        }
    }
    private(set) var errorMessage: String?
    private(set) var pendingEvent: RecordingEvent?
    var selectedID: UUID?
    private var telemetryRevisions: [UUID: [UUID: Int]] = [:]

    func telemetryRevision(recordingID: UUID, intervalID: UUID) -> Int {
        telemetryRevisions[recordingID]?[intervalID] ?? 0
    }
    private(set) var liveTelemetryObservations: [UUID: PendingCodexTelemetryObservation] = [:]

    // Bridge the committed receipt into the existing timeline row before its database reload.
    private(set) var committedTelemetryPreviews: [UUID: RecordingTelemetryObservation] = [:]

    func didLoadTelemetry(_ observations: [RecordingTelemetryObservation]) {
        for observation in observations { committedTelemetryPreviews.removeValue(forKey: observation.id) }
    }

    private(set) var liveTelemetryWarnings: [UUID: String] = [:]

    func setLiveTelemetryWarning(_ message: String?, bindingID: UUID) {
        guard liveTelemetryWarnings[bindingID] != message else { return }
        liveTelemetryWarnings[bindingID] = message
    }

    func discardLiveTelemetry(bindingIDs: Set<UUID>) {
        liveTelemetryObservations = liveTelemetryObservations.filter {
            !bindingIDs.contains($0.value.metadata.bindingID)
        }
        liveTelemetryWarnings = liveTelemetryWarnings.filter { !bindingIDs.contains($0.key) }
    }

    func canPreviewTelemetry(_ grant: CodexIntakeContract.Grant) -> Bool {
        canAct && acceptingEvents && !grant.revoked && stamp().wall <= grant.acceptUntil
            && grant.binding.localScopeID == localScopeID
            && grant.binding.recordingID == current?.id
            && grant.binding.intervalID == current?.activeIntervalID
            && telemetry.canPreview(bindingID: grant.binding.bindingID)
    }

    /// Bounds apply across every session and interval in this process. The helper retains
    /// the original queue when previews are full; ordinary durable delivery is unaffected.
    func previewLocalCodexTelemetry(
        _ packet: CodexIntakeContract.Packet,
        grant: CodexIntakeContract.Grant
    ) throws -> Bool {
        guard canPreviewTelemetry(grant), let interval = current?.intervals.last,
            interval.end == nil, !interval.interrupted
        else { throw CodexTelemetryContract.Failure.invalidAssociation }
        let observation = try PendingCodexTelemetryObservation(
            packet: packet, grant: grant, intervalStart: interval.start.wall, now: stamp().wall)
        if let existing = liveTelemetryObservations[observation.id] {
            guard existing.exactBody == observation.exactBody else {
                throw CodexTelemetryContract.Failure.identityConflict
            }
            return true
        }
        guard liveTelemetryObservations.count < 1000 else { return false }
        liveTelemetryObservations[observation.id] = observation
        return true
    }

    func loadTelemetryReview(recordingID: UUID, intervalID: UUID) async throws -> [RecordingTelemetryObservation] {
        try await repository.loadCodexTelemetryReview(
            localScopeID: localScopeID, recordingID: recordingID, intervalID: intervalID)
    }

    /// Task persistence shares the recording operation slot. Capture received while it awaits
    /// storage must drain before the slot is released or a later lifecycle action can run.
    func runTaskAction(_ action: @escaping @MainActor () async -> Void) {
        guard canConfigureRecording else { return }
        if isBusy {
            // Reserve the next user action without racing the in-flight capture write/ACK.
            isPerformingUserAction = true
            queuedTaskAction = action
            queuedTaskPrecedingEventCount = queuedEvents.count
            return
        }
        run {
            await action()
            await self.drainTaskCaptureQueue()
        }
    }

    private func drainTaskCaptureQueue() async {
        // Capture can enqueue foreground events or pause while the repository is awaiting IO.
        await runQueuedTaskIfReady()
        if pendingEvent == nil, !queuedEvents.isEmpty {
            pendingEvent = takeQueuedEvent()
            await commitPending()
        }
    }

    private func runQueuedTaskIfReady() async {
        guard pendingEvent == nil, queuedTaskPrecedingEventCount == 0,
            let action = queuedTaskAction
        else { return }
        queuedTaskAction = nil
        await action()
    }

    private func takeQueuedEvent() -> RecordingEvent {
        if queuedTaskPrecedingEventCount > 0 { queuedTaskPrecedingEventCount -= 1 }
        return queuedEvents.removeFirst()
    }

    @ObservationIgnored private let repository: any RecordingRepository
    @ObservationIgnored private let stamp: @MainActor () -> RecordingEvent.Stamp
    @ObservationIgnored private var queuedEvents: [RecordingEvent] = []
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var queuedTaskAction: (@MainActor () async -> Void)?
    @ObservationIgnored private var queuedTaskPrecedingEventCount = 0
    @ObservationIgnored private var isShuttingDown = false
    @ObservationIgnored private var isClosed = false
    @ObservationIgnored private var needsRecovery = true
    @ObservationIgnored var captureStateDidChange: (@MainActor () -> Void)?
    @ObservationIgnored private(set) lazy var tasks = RecordingTaskModel(
        recording: self, repository: repository, stamp: stamp)
    @ObservationIgnored lazy var codex = LocalCodexIntakeModel(recording: self)
    @ObservationIgnored private let telemetryRuntime: LocalHarnessRuntime?
    @ObservationIgnored private let telemetryPreferences: UserDefaults
    @ObservationIgnored lazy var telemetry = LocalCodexTelemetryModel(
        recording: self, runtime: telemetryRuntime ?? LocalHarnessRuntime(), preferences: telemetryPreferences)
    @ObservationIgnored lazy var harness = LocalHarnessModel(recording: self)

    init(
        repository: any RecordingRepository = SQLiteRecordingRepository(), localScopeID: String = "synthetic-default",
        stamp: (@MainActor () -> RecordingEvent.Stamp)? = nil,
        telemetryRuntime: LocalHarnessRuntime? = nil, telemetryPreferences: UserDefaults = .standard
    ) {
        self.repository = repository
        self.localScopeID = localScopeID
        self.telemetryRuntime = telemetryRuntime
        self.telemetryPreferences = telemetryPreferences
        let processID = UUID()
        self.stamp = stamp ?? { .init(wall: .now, uptime: ProcessInfo.processInfo.systemUptime, processID: processID) }
    }

    var current: RecordingSnapshot? { recordings.first(where: { $0.status != .finished }) }
    var selected: RecordingSnapshot? { recordings.first(where: { $0.id == selectedID }) ?? current ?? recordings.first }
    var canAct: Bool { isLoaded && !isBusy && pendingEvent == nil && !isClosed && !isShuttingDown && !needsRecovery }
    /// Background capture still owns the write gate, but must not pulse native controls.
    /// Task actions accepted here reserve that gate and retain their original command.
    var canConfigureRecording: Bool {
        isLoaded && !isPerformingUserAction && errorMessage == nil && !isClosed && !isShuttingDown && !needsRecovery
    }
    var canDeleteRecording: Bool { isBusy ? canConfigureRecording : canAct }
    var canCaptureForegroundApplications: Bool {
        isLoaded && !isClosed && !isShuttingDown && !needsRecovery && errorMessage == nil
            && acceptingEvents && current?.capturesForegroundApplications == true
    }
    var saveStatus: String {
        if pendingEvent != nil, errorMessage != nil { return "Stopped — action not confirmed saved" }
        if errorMessage != nil { return "Local history unavailable" }
        if !isLoaded { return "Local history not loaded" }
        if acceptingEvents && current?.status == .recording { return "Recording on this Mac · No upload" }
        if isPerformingUserAction { return "Saving or loading local history…" }
        return "Saved on this Mac · No upload"
    }

    func load() {
        guard !isLoaded, !isBusy, !isClosed, !isShuttingDown, pendingEvent == nil else { return }
        run { await self.restore() }
    }

    func startRecording() {
        guard canConfigureRecording, current == nil else { return }
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: UUID(), intervalID: UUID(), kind: .start, stamp: stamp(),
                text: "Synthetic workflow sample"))
    }

    func startForegroundApplicationRecording() {
        guard canConfigureRecording, current == nil else { return }
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: UUID(), intervalID: UUID(), kind: .start, stamp: stamp(),
                text: "Foreground application recording", captureConfiguration: .foregroundApplicationOnly))
    }

    /// A source boundary must not wait for a prior interval's delivery acknowledgement.
    /// It is still committed by the existing operation queue, after the in-flight native write.
    var canPauseRecording: Bool {
        isLoaded && !isClosed && !isShuttingDown && !needsRecovery && errorMessage == nil
            && !tasks.hasPendingTaskAction && acceptingEvents && current?.activeIntervalID != nil
    }
    var canFinishRecording: Bool {
        canPauseRecording
            || (canConfigureRecording && !tasks.hasPendingTaskAction && current != nil && !acceptingEvents)
    }

    func pause() {
        if acceptingEvents {
            closeActiveInterval(.pause, text: "Manual pause — explicit Resume required")
        } else if canAct, !tasks.hasPendingTaskAction, current?.status == .suspended {
            // Preserve the existing explicit suspended-to-paused transition without reopening coverage.
            transition(.pause, text: "Manual pause — explicit Resume required")
        }
    }

    private func closeActiveInterval(_ kind: RecordingEvent.Kind, text: String) {
        guard canPauseRecording, let current, let intervalID = current.activeIntervalID else { return }
        // This synchronous assignment publishes the helper fence before waiting for SQLite or ACK.
        // It also disables another boundary while this exact event waits in the existing queue.
        acceptingEvents = false
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: current.id, intervalID: intervalID,
                kind: kind, stamp: stamp(), text: text))
        captureStateDidChange?()
    }

    /// Revoke intake at the click, retaining a boundary behind any in-flight start or observation.
    func pauseFromTimer() {
        guard isLoaded, !isClosed, !isShuttingDown, !needsRecovery else { return }
        acceptingEvents = false
        guard isBusy || pendingEvent == nil else {
            // Retry must repair an already-failed save with an unknown coverage gap.
            // A later click cannot establish a known end for that interrupted capture.
            captureStateDidChange?()
            return
        }
        let pending = [pendingEvent].compactMap { $0 } + queuedEvents
        let boundary = pending.last(where: { !$0.kind.isObservation })
        let recordingID: UUID
        let intervalID: UUID
        if let boundary {
            guard boundary.kind == .start || boundary.kind == .resume, let id = boundary.intervalID else {
                captureStateDidChange?()
                return
            }
            recordingID = boundary.recordingID
            intervalID = id
        } else {
            guard let current, let id = current.activeIntervalID else {
                captureStateDidChange?()
                return
            }
            recordingID = current.id
            intervalID = id
        }
        let event = RecordingEvent(
            localScopeID: localScopeID, recordingID: recordingID, intervalID: intervalID,
            kind: .pause, stamp: stamp(), text: "Timer paused — explicit Resume required")
        if pendingEvent != nil {
            // Preserve the in-flight event's identity and receipt order.
            queuedEvents.append(event)
        } else {
            submit(event)
        }
        captureStateDidChange?()
    }

    func resume() { transition(.resume, text: "Explicit resume — new interval") }
    func finish() {
        guard canFinishRecording else { return }
        if acceptingEvents {
            closeActiveInterval(.finish, text: "Recording finished")
        } else {
            transition(.finish, text: "Recording finished")
        }
    }
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
        guard recording.localScopeID == localScopeID, recording.status != .recording else { return }
        if isBusy {
            guard canConfigureRecording else { return }
            runTaskAction { await self.performDelete(recording) }
        } else {
            guard canAct else { return }
            run { await self.performDelete(recording) }
        }
    }

    private func performDelete(_ recording: RecordingSnapshot) async {
        var deletionError: String?
        do {
            try await repository.delete(recording.id, localScopeID: localScopeID)
            recordings.removeAll { $0.id == recording.id }
            telemetryRevisions.removeValue(forKey: recording.id)
            committedTelemetryPreviews = committedTelemetryPreviews.filter {
                $0.value.metadata.recordingID != recording.id
            }
            liveTelemetryObservations = liveTelemetryObservations.filter {
                $0.value.metadata.recordingID != recording.id
            }
            await tasks.reloadTaskAttribution()
            if selectedID == recording.id { selectedID = recordings.first?.id }
            errorMessage = nil
        } catch {
            deletionError = error.localizedDescription
            errorMessage = deletionError
            acceptingEvents = false
            captureStateDidChange?()
        }
        // Capture may enqueue observations and lifecycle boundaries during the deletion await.
        // Drain them before allowing a later user action to overtake their receipt order.
        if !queuedEvents.isEmpty {
            pendingEvent = queuedEvents.removeFirst()
            await commitPending()
        } else if deletionError != nil, let current, current.status == .recording {
            // With no queued event, commitPending has nothing to trigger its failure-gap policy.
            pendingEvent = RecordingEvent(
                localScopeID: current.localScopeID, recordingID: current.id, intervalID: current.activeIntervalID,
                kind: .interrupt, stamp: stamp(),
                text: "Storage failure — coverage unknown; explicit Resume required")
            await commitPending()
        }
        // Successful coverage repair must not hide the failed deletion. A pending write error
        // takes priority so Retry continues to refer to that exact unsaved event.
        if pendingEvent == nil, let deletionError { errorMessage = deletionError }
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
        telemetry.revoke(bindingID: bindingID)
        liveTelemetryObservations = liveTelemetryObservations.filter { $0.value.metadata.bindingID != bindingID }
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

    func receiveLocalCodexTelemetry(
        _ packet: CodexIntakeContract.Packet, bindingID: UUID,
        acknowledge: (@MainActor (CodexIntakeContract.Packet) async throws -> Void)? = nil
    ) async throws -> CodexIntakeContract.Packet {
        try await codexAction {
            let ack = try await self.repository.receiveCodexTelemetry(
                packet, bindingID: bindingID, stamp: self.stamp())
            let metadata = try CodexTelemetryContract.parse(packet.body)
            if self.liveTelemetryObservations[metadata.observationID] != nil {
                // Bound offscreen handoffs; durable history remains available from SQLite.
                if self.committedTelemetryPreviews.count >= 1000,
                    let oldest = self.committedTelemetryPreviews.values.min(by: {
                        $0.nativeReceivedAt < $1.nativeReceivedAt
                    })
                {
                    self.committedTelemetryPreviews.removeValue(forKey: oldest.id)
                }
                self.committedTelemetryPreviews[metadata.observationID] = try RecordingTelemetryObservation(
                    body: packet.body, receipt: ack.body)
            }
            self.liveTelemetryObservations.removeValue(forKey: metadata.observationID)
            self.telemetryRevisions[metadata.recordingID, default: [:]][metadata.intervalID, default: 0] += 1
            try Task.checkCancellation()
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
        run(isBackground: true) {
            do { result = .success(try await action()) } catch { result = .failure(error) }
            await self.drainTaskCaptureQueue()
        }
        await waitForIdle()
        guard let result else { throw RecordingError.invalidTransition }
        return try result.get()
    }

    /// Scope changes never retarget a queued action. Finish the old scope before switching.
    func switchScope(to scope: String) async -> Bool {
        guard canAct, !tasks.hasPendingTaskAction, current == nil, !scope.isEmpty, scope.utf8.count <= 200 else {
            return false
        }
        liveTelemetryObservations.removeAll()
        committedTelemetryPreviews.removeAll()
        localScopeID = scope
        telemetryRevisions.removeAll()
        recordings = []
        tasks.resetForScopeChange()
        selectedID = nil
        isLoaded = false
        load()
        await waitForIdle()
        return isLoaded && errorMessage == nil
    }

    /// Ordinary Quit is refused if a pending boundary cannot be saved. Crash recovery is separate.
    func shutdown() async -> Bool {
        guard !isClosed else { return true }
        // Resolve or explicitly dismiss an unconfirmed review action before stopping capture services.
        guard !tasks.hasPendingTaskAction else { return false }
        isShuttingDown = true
        acceptingEvents = false
        await telemetry.waitForIdle()
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
        liveTelemetryObservations.removeAll()
        committedTelemetryPreviews.removeAll()
        isClosed = true
        return true
    }

    private func transition(_ kind: RecordingEvent.Kind, text: String) {
        guard canConfigureRecording, let current else { return }
        acceptingEvents = false
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: current.id,
                intervalID: kind == .resume ? UUID() : current.intervals.last?.id, kind: kind, stamp: stamp(),
                text: text))
    }

    private func addSample(_ kind: RecordingEvent.Kind, text: String) {
        guard canConfigureRecording, acceptingEvents, let current, let intervalID = current.activeIntervalID else {
            return
        }
        submit(
            RecordingEvent(
                localScopeID: localScopeID, recordingID: current.id, intervalID: intervalID, kind: kind, stamp: stamp(),
                text: text))
    }

    private func submit(_ event: RecordingEvent) {
        if isBusy {
            if !event.kind.isObservation { isPerformingUserAction = true }
            queuedEvents.append(event)
            return
        }
        pendingEvent = event
        run(isBackground: event.kind.isObservation) { await self.commitPending() }
    }

    private func run(isBackground: Bool = false, _ action: @escaping @MainActor () async -> Void) {
        isPerformingUserAction = !isBackground
        isBusy = true
        operation = Task {
            await action()
            await self.drainTaskCaptureQueue()
            self.isBusy = false
            self.isPerformingUserAction = false
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
            await tasks.reloadTaskAttribution()
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
                    if event.kind == .start { selectedID = saved.id }
                }
                pendingEvent = nil
                errorMessage = nil
                await runQueuedTaskIfReady()
                if !queuedEvents.isEmpty {
                    // Keep receipt order and timestamps, including a boundary that revoked intake
                    // while this commit was suspended. Never reauthorize between queued saves.
                    pendingEvent = takeQueuedEvent()
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
                    if saved.status == .finished { telemetry.automatic.recordingDidFinish() }
                    if acceptingEvents && (event.kind == .start || event.kind == .resume) {
                        telemetry.automatic.recordingDidActivate()
                    }
                }
            } catch {
                acceptingEvents = false
                errorMessage = error.localizedDescription
                return
            }
        }
    }
}
