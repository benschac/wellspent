import Foundation
import Observation

/// The app owns connection approval and admission. MCP discovery never starts a recording.
@MainActor
@Observable
final class LocalHarnessModel {
    private(set) var status = "Codex is not connected"
    private(set) var isConnected = false
    private(set) var isBusy = false
    private(set) var needsRestart = false
    private(set) var hasError = false

    @ObservationIgnored private weak var recording: RecordingModel?
    @ObservationIgnored private let runtime: LocalHarnessRuntime
    @ObservationIgnored private var connection: LocalHarnessContract.Connection?
    @ObservationIgnored private let epoch = UUID()
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var action: Task<Void, Never>?
    @ObservationIgnored private var isStopped = false
    @ObservationIgnored private var hasStarted = false

    init(recording: RecordingModel, runtime: LocalHarnessRuntime = LocalHarnessRuntime()) {
        self.recording = recording
        self.runtime = runtime
    }

    var recordingStatus: String {
        guard recording?.activeHarnessInterval != nil else {
            return "No active interval — new notes are not logged. Start or resume a recording yourself."
        }
        guard isConnected, let connection else { return "Recording active. Connect Codex to submit notes." }
        guard connection.localScopeID == recording?.localScopeID else {
            return "This connection belongs to a different local scope. New notes are not logged."
        }
        guard !isBusy, !hasError, !isStopped, polling != nil else {
            return "Recording active; local note delivery is unavailable until the connection recovers."
        }
        if needsRestart { return "Recording active. Open a new Codex session to discover log_work." }
        return "New notes can be saved to the active local recording."
    }

    func start() {
        guard polling == nil, action == nil else { return }
        hasStarted = true
        isStopped = false
        isBusy = true
        action = Task {
            defer {
                action = nil
                isBusy = false
            }
            connection = await runtime.connection()
            guard !Task.isCancelled, !isStopped else { return }
            if let connection, !connection.revoked {
                isConnected = true
                needsRestart = true
                status = "Checking the local Codex connection…"
                beginPolling()
            } else if let error = runtime.connectionError {
                hasError = true
                status = error
            }
        }
    }

    /// Only the explicit installation confirmation calls this method.
    func connect() {
        guard action == nil, !isBusy, !isStopped, let recording else { return }
        isBusy = true
        hasError = false
        status = "Connecting Codex…"
        action = Task {
            defer {
                isBusy = false
                action = nil
            }
            await stopPolling()
            do {
                connection = try await runtime.connect(scope: recording.localScopeID)
                guard !Task.isCancelled, !isStopped else { return }
                isConnected = true
                needsRestart = true
                status = "Restart Codex required — open a new session to discover log_work."
                beginPolling()
            } catch is CancellationError {
                return
            } catch {
                hasError = true
                status =
                    (error as? LocalHarnessRuntime.Failure)?.errorDescription
                    ?? "Connection failed. Check Node and the Codex CLI are installed, and that wellspent-local is not used by another connection. Then retry Connect."
            }
        }
    }

    func disconnect() {
        guard action == nil, !isBusy, !isStopped else { return }
        isBusy = true
        action = Task {
            defer {
                isBusy = false
                action = nil
            }
            // Cancel admission first; wait for any earlier commit before saving revocation.
            await stopPolling()
            do {
                try await runtime.revoke()
                connection = nil
                isConnected = false
                needsRestart = false
                hasError = false
                runtime.stopHelper()
                status = "Disconnected — new calls are blocked. Saved notes remain on this Mac."
            } catch {
                hasError = true
                status =
                    (error as? LocalHarnessRuntime.Failure)?.errorDescription
                    ?? "Revocation could not be confirmed. Intake is stopped in this app; retry Disconnect to save revocation."
            }
        }
    }

    func stop() async {
        isStopped = true
        action?.cancel()
        await stopPolling()
        await action?.value
        action = nil
        runtime.stopHelper()
    }

    func resumeAfterFailedShutdown() {
        if hasStarted { start() }
    }

    func waitForIdle() async { await action?.value }

    private func stopPolling() async {
        polling?.cancel()
        await polling?.value
        polling = nil
    }

    private func beginPolling() {
        guard polling == nil, !isStopped else { return }
        polling = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await pollOnce()
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
    }

    private func pollOnce() async {
        guard let connection, !connection.revoked, let recording else { return }
        do {
            try await runtime.startHelper()
            try Task.checkCancellation()
            let transport = try LocalHarnessTransport(endpoint: connection.endpoint)
            let active = connection.localScopeID == recording.localScopeID ? recording.activeHarnessInterval : nil
            let response = try await transport.poll(connection: connection, epoch: epoch, active: active)
            try Task.checkCancellation()
            needsRestart = !response.discovered
            hasError = false
            status =
                needsRestart
                ? "Restart Codex required — open a new session to discover log_work."
                : "Connected — a Codex session discovered log_work."
            guard let packet = response.request else { return }
            let note = try LocalHarnessContract.note(packet, connection: connection)
            // A recording save may be in progress. Retain this request for the next poll;
            // never publish an ACK before its commit or relabel a transient store failure.
            guard recording.canAct else { return }
            do {
                let saved = try await recording.receiveWorkNote(packet, connection: connection, epoch: epoch)
                try Task.checkCancellation()
                try await transport.complete(
                    connection: connection, request: packet, note: note, status: "acknowledged",
                    reason: "saved", nativeReceivedAt: saved.stamp.wall)
                status = "Connected — latest note saved on this Mac."
            } catch let failure as LocalHarnessContract.Failure {
                try Task.checkCancellation()
                try await transport.complete(
                    connection: connection, request: packet, note: note, status: "rejected",
                    reason: failure.rawValue, nativeReceivedAt: nil)
                status = "Connected — note not logged (\(failure.rawValue))."
            }
        } catch is CancellationError {
            return
        } catch {
            if Task.isCancelled { return }
            hasError = true
            status =
                (error as? LocalHarnessRuntime.Failure)?.errorDescription
                ?? "Local connection unavailable; retrying. Notes are successful only after a saved acknowledgement. Check Node, or reconnect Codex."
        }
    }
}
