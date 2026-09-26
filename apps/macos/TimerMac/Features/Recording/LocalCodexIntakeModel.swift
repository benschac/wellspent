import Foundation
import Observation

/// App-owned polling. Constructing the model does not pair a thread or enable a hook.
@MainActor
@Observable
final class LocalCodexIntakeModel {
    private(set) var grants: [CodexIntakeContract.Grant] = []
    private(set) var status = "No local Codex pairing"
    private(set) var pairingBundle: String?
    private(set) var isPairing = false
    var senderID = ""
    var threadID = ""
    var port = 43871

    @ObservationIgnored private weak var recording: RecordingModel?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var action: Task<Void, Never>?
    @ObservationIgnored private var retries: [UUID: (failures: Int, after: ContinuousClock.Instant)] = [:]

    @ObservationIgnored private var previewCursors: [UUID: String] = [:]

    init(recording: RecordingModel) { self.recording = recording }

    var canPair: Bool {
        recording?.canAct == true && recording?.current?.activeIntervalID != nil && !isPairing
            && !senderID.isEmpty && !threadID.isEmpty && (1024...65535).contains(port)
    }

    func start() {
        guard task == nil else { return }
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                _ = await self.pollOnce()
                // Each failed binding backs off independently. Healthy queues keep draining.
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
            }
        }
    }

    func stop() async {
        task?.cancel()
        action?.cancel()
        await task?.value
        await action?.value
        task = nil
        action = nil
        pairingBundle = nil
        previewCursors.removeAll()
    }

    func dismissBundle() { pairingBundle = nil }

    func pair() {
        guard canPair, let recording, action == nil else { return }
        isPairing = true
        pairingBundle = nil
        action = Task {
            defer {
                isPairing = false
                action = nil
            }
            do {
                let bundle = try await recording.pairLocalCodex(
                    senderID: senderID, threadID: threadID, endpoint: "http://127.0.0.1:\(port)")
                try Task.checkCancellation()
                let data = try JSONEncoder().encode(bundle)
                pairingBundle = String(decoding: data, as: UTF8.self)
                grants = try await recording.localCodexGrants()
                status = "Pairing saved on this Mac. Supply the bundle to the helper through stdin."
            } catch is CancellationError {
                return
            } catch {
                status = "Pairing unavailable; check the identifiers and active recording interval."
            }
        }
    }

    func revoke(_ bindingID: UUID) {
        guard let recording, recording.canAct, action == nil else { return }
        action = Task {
            defer { action = nil }
            do {
                try await recording.revokeLocalCodex(bindingID: bindingID)
                pairingBundle = nil
                grants = try await recording.localCodexGrants()
                status = "Pairing revoked; this binding can no longer add or acknowledge reports."
            } catch {
                status = "Revocation was not confirmed saved. Retry when local history is available."
            }
        }
    }

    @discardableResult
    func pollOnce() async -> Bool {
        guard let recording, recording.canAct, action == nil else { return true }
        await recording.telemetry.readIfAuthorized()
        do {
            grants = try await recording.localCodexGrants()
            let active = grants.filter { !$0.revoked && $0.binding.localScopeID == recording.localScopeID }
            let activeIDs = Set(active.map { $0.binding.bindingID })
            retries = retries.filter { activeIDs.contains($0.key) }
            previewCursors = previewCursors.filter { activeIDs.contains($0.key) }
            if active.isEmpty {
                status = "No active local Codex pairing"
                return true
            }
            var messages: [String] = []
            var allAvailable = true
            for grant in active.sorted(by: { $0.issuedAt > $1.issuedAt }) {
                try Task.checkCancellation()
                guard recording.canAct else { return true }
                let bindingID = grant.binding.bindingID
                if let retry = retries[bindingID], ContinuousClock.now < retry.after {
                    messages.append("Thread \(grant.binding.threadID): retry scheduled; other connections continue.")
                    continue
                }
                do {
                    let transport = try LocalCodexTransport(endpoint: grant.endpoint)
                    let response = try await transport.poll(bindingID: grant.binding.bindingID, key: grant.key)
                    try Task.checkCancellation()
                    let counts =
                        "Helper reports \(response.status.pending) pending, \(response.status.quarantined) rejected, \(response.status.unassociated) unassociated."
                    let reasons = response.status.reasons.sorted { $0.key < $1.key }
                        .map { "\($0.key): \($0.value)" }.joined(separator: ", ")
                    var message = "Thread \(grant.binding.threadID): \(counts) \(reasons)"
                    if let packet = response.packet, !awaitsIntervalEnd(grant, recording: recording) {
                        guard recording.canAct else { return true }
                        do {
                            _ = try await recording.receiveLocalCodex(packet, bindingID: grant.binding.bindingID) {
                                ack in
                                try await transport.acknowledge(ack)
                            }
                            message += " Report saved locally; acknowledgement delivered."
                        } catch let failure as CodexIntakeContract.Failure {
                            message +=
                                failure == .awaitingIntervalEnd
                                ? " Waiting for Pause or Finish to establish the interval end."
                                : " Excluded: \(failure.rawValue)."
                            if failure != .awaitingIntervalEnd,
                                let currentGrant = try await recording.localCodexGrants().first(where: {
                                    $0.binding.bindingID == grant.binding.bindingID && !$0.revoked
                                }),
                                let eventID = CodexIntakeContract.rejectionIdentity(packet, grant: currentGrant)
                            {
                                try await transport.reject(
                                    bindingID: grant.binding.bindingID, eventID: eventID,
                                    bodyDigest: CodexIntakeContract.digest(packet.body), reason: failure.rawValue,
                                    key: grant.key)
                            }
                        }
                    } else if response.packet != nil {
                        message += " Waiting for Pause or Finish to establish the interval end."
                    }
                    do {
                        if try await transport.telemetrySupported(bindingID: grant.binding.bindingID, key: grant.key) {
                            let telemetry = try await transport.pollTelemetry(
                                bindingID: grant.binding.bindingID, key: grant.key)
                            if telemetry.unsupported > 0 {
                                message +=
                                    " \(telemetry.unsupported) unsupported telemetry packet(s) retained by helper; update both apps or inspect the local queue."
                            }
                            if let packet = telemetry.packet, !awaitsIntervalEnd(grant, recording: recording) {
                                guard recording.canAct else { return true }
                                do {
                                    _ = try await recording.receiveLocalCodexTelemetry(
                                        packet, bindingID: grant.binding.bindingID
                                    ) { ack in try await transport.acknowledgeTelemetry(ack) }
                                    message += " Telemetry saved locally and acknowledged."
                                } catch let failure as CodexTelemetryContract.Failure {
                                    message +=
                                        failure == .awaitingIntervalEnd
                                        ? " Telemetry waiting for Pause or Finish."
                                        : " Telemetry retained; \(failure.rawValue). Inspect the binding or update the helper."
                                }
                            } else if telemetry.packet != nil {
                                message += " Telemetry waiting for Pause or Finish."
                            }
                        } else {
                            message += " Helper has no compatible telemetry capability; v1 reports continue."
                        }
                    } catch LocalCodexTransport.Failure.http(400) {
                        message += " Helper does not support telemetry; update helper when ready. v1 reports continue."
                    }
                    // Preview failure never delays either durable delivery channel.
                    if recording.canPreviewTelemetry(grant) {
                        recording.setLiveTelemetryWarning(nil, bindingID: bindingID)
                        do {
                            if try await transport.telemetryPreviewSupported(bindingID: bindingID, key: grant.key) {
                                let page = try await transport.previewTelemetry(
                                    bindingID: bindingID, key: grant.key, cursor: previewCursors[bindingID])
                                try Task.checkCancellation()
                                for packet in page.packets {
                                    guard recording.canPreviewTelemetry(grant) else { break }
                                    if try !recording.previewLocalCodexTelemetry(packet, grant: grant) {
                                        recording.setLiveTelemetryWarning(
                                            "Live preview limit reached (1,000). Eligible queued metadata saves after Pause or Finish.",
                                            bindingID: bindingID)
                                        message +=
                                            " Live preview limit reached (1,000); eligible queued metadata saves after Pause or Finish."
                                        break
                                    }
                                }
                                previewCursors[bindingID] = page.nextCursor
                            } else {
                                recording.setLiveTelemetryWarning(
                                    "Restart bun run dev to enable the live Codex timeline with the updated helper.",
                                    bindingID: bindingID)
                                message +=
                                    " Live timeline requires a helper update; queued metadata remains available after Pause or Finish."
                            }
                        } catch is CancellationError { throw CancellationError() } catch {
                            if recording.canPreviewTelemetry(grant) {
                                recording.setLiveTelemetryWarning(
                                    "Live Codex preview unavailable. Queued telemetry is retained; retrying automatically.",
                                    bindingID: bindingID)
                            }
                            message += " Live preview unavailable; queued telemetry retained for ordinary delivery."
                        }
                    } else {
                        previewCursors.removeValue(forKey: bindingID)
                    }
                    messages.append(message)
                    retries.removeValue(forKey: bindingID)
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    if Task.isCancelled { throw CancellationError() }
                    allAvailable = false
                    let failures = min((retries[bindingID]?.failures ?? 0) + 1, 4)
                    retries[bindingID] = (failures, .now.advanced(by: .seconds(min(2 << failures, 30))))
                    messages.append(
                        "Thread \(grant.binding.threadID): helper or storage unavailable; pending reports retained for retry."
                    )
                }
            }
            status = messages.joined(separator: "\n")
            return allAvailable
        } catch is CancellationError {
            return true
        } catch {
            if Task.isCancelled { return true }
            status = "Local helper or storage unavailable. Pending reports remain queued; retrying automatically."
            return false
        }
    }

    /// An open interval cannot admit durable reports yet. Keep polling/previews alive without
    /// taking the recording write slot (and disabling every control) for a predictable rejection.
    /// Older closed intervals still deliver while a new interval is recording.
    private func awaitsIntervalEnd(_ grant: CodexIntakeContract.Grant, recording: RecordingModel) -> Bool {
        guard let current = recording.current else { return false }
        return grant.binding.localScopeID == current.localScopeID
            && grant.binding.recordingID == current.id
            && grant.binding.intervalID == current.activeIntervalID
    }
}
