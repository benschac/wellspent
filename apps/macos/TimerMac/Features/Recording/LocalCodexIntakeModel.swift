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

    init(recording: RecordingModel) { self.recording = recording }

    var canPair: Bool {
        recording?.canAct == true && recording?.current?.activeIntervalID != nil && !isPairing
            && !senderID.isEmpty && !threadID.isEmpty && (1024...65535).contains(port)
    }

    func start() {
        guard task == nil else { return }
        task = Task { [weak self] in
            var delay = 2
            while !Task.isCancelled {
                guard let self else { return }
                let succeeded = await self.pollOnce()
                delay = succeeded ? 2 : min(delay * 2, 30)
                do { try await Task.sleep(for: .seconds(delay)) } catch { return }
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
        do {
            grants = try await recording.localCodexGrants()
            let active = grants.filter { !$0.revoked && $0.binding.localScopeID == recording.localScopeID }
            if active.isEmpty {
                status = "No active local Codex pairing"
                return true
            }
            var messages: [String] = []
            var allAvailable = true
            for grant in active {
                try Task.checkCancellation()
                guard recording.canAct else { return true }
                do {
                    let transport = try LocalCodexTransport(endpoint: grant.endpoint)
                    let response = try await transport.poll(bindingID: grant.binding.bindingID, key: grant.key)
                    try Task.checkCancellation()
                    let counts =
                        "Helper reports \(response.status.pending) pending, \(response.status.quarantined) rejected, \(response.status.unassociated) unassociated."
                    let reasons = response.status.reasons.sorted { $0.key < $1.key }
                        .map { "\($0.key): \($0.value)" }.joined(separator: ", ")
                    var message = "Thread \(grant.binding.threadID): \(counts) \(reasons)"
                    if let packet = response.packet {
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
                    }
                    messages.append(message)
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    if Task.isCancelled { throw CancellationError() }
                    allAvailable = false
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
}
