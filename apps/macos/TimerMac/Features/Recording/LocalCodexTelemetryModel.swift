import Foundation
import Observation

/// Source consent is process-local. Durable grants authorize admission, never source reopening.
@MainActor
@Observable
final class LocalCodexTelemetryModel {
    var filePath = ""
    var threadID = ""
    var sessionID = ""
    var eofOffset = ""
    var port = 43872
    private var manualStatus = "Inactive — no source authorized"
    private(set) var isBusy = false
    private(set) var isCollecting = false

    let automatic: AutomaticCodexCaptureModel
    var selectedSourceStatus: String { manualStatus }
    var status: String {
        authorization != nil || isCollecting ? manualStatus : (automatic.hasState ? automatic.status : manualStatus)
    }

    @ObservationIgnored private weak var recording: RecordingModel?
    @ObservationIgnored private let runtime: LocalHarnessRuntime
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var authorization: Authorization?
    @ObservationIgnored private var generation = UUID()

    private struct Authorization {
        let id: UUID
        let bindingID: UUID
        let recordingID: UUID
        let intervalID: UUID
        let endsAt: Date

        var payload: Data {
            // UUID strings cannot fail JSON encoding.
            Data(
                "{\"authorizationID\":\"\(id.uuidString.lowercased())\",\"bindingID\":\"\(bindingID.uuidString.lowercased())\"}"
                    .utf8)
        }
    }

    init(
        recording: RecordingModel, runtime: LocalHarnessRuntime = LocalHarnessRuntime(),
        preferences: UserDefaults = .standard
    ) {
        self.recording = recording
        self.runtime = runtime
        automatic = AutomaticCodexCaptureModel(recording: recording, runtime: runtime, preferences: preferences)
    }

    var canAuthorize: Bool {
        guard let recording else { return false }
        return recording.canAct && recording.acceptingEvents && recording.current?.activeIntervalID != nil
            && !isBusy && !isCollecting && filePath.hasPrefix("/") && !threadID.isEmpty && !sessionID.isEmpty
            && Int(eofOffset).map { $0 >= 0 } == true && (1024...65535).contains(port)
    }

    func authorize() {
        guard canAuthorize, let recording, let current = recording.current,
            let intervalID = current.activeIntervalID, let eof = Int(eofOffset)
        else { return }
        automatic.stop()
        let token = UUID()
        generation = token
        let path = filePath
        let thread = threadID
        let session = sessionID
        let endpoint = "http://127.0.0.1:\(port)"
        isBusy = true
        manualStatus = "Authorizing selected source…"
        operation = Task {
            defer { if generation == token { isBusy = false } }
            do {
                await automatic.waitForIdle()
                guard generation == token, recording.acceptingEvents,
                    recording.current?.activeIntervalID == intervalID
                else { return }
                if let old = authorization {
                    _ = try? await runtime.telemetryCommand(id: UUID(), action: "stop", payload: old.payload)
                    authorization = nil
                }
                let bundle = try await recording.pairLocalCodex(
                    senderID: "wellspent-selected-telemetry", threadID: thread, endpoint: endpoint)
                guard generation == token, recording.acceptingEvents,
                    recording.current?.activeIntervalID == intervalID
                else { return }
                let auth = Authorization(
                    id: UUID(), bindingID: bundle.binding.bindingID, recordingID: current.id,
                    intervalID: intervalID, endsAt: Date().addingTimeInterval(180))
                let payload: [String: Any] = [
                    "bundle": try JSONSerialization.jsonObject(with: JSONEncoder().encode(bundle)),
                    "selection": [
                        "filePath": path, "sessionID": session,
                        "bindingID": auth.bindingID.uuidString.lowercased(), "eofOffset": eof,
                        "sourceVersion": "0.157.1", "endsAt": CodexIntakeContract.timestamp(auth.endsAt),
                        "maxBytes": 2 * 1024 * 1024,
                    ],
                ]
                // Keep this identity until even a failed/lost activation reply has been stopped.
                authorization = auth
                try runtime.setTelemetryPermit(authorizationID: auth.id, bindingID: auth.bindingID, enabled: true)
                let result = try await runtime.telemetryCommand(
                    id: auth.id, action: "activate", payload: JSONSerialization.data(withJSONObject: payload))
                guard generation == token, recording.acceptingEvents,
                    recording.current?.activeIntervalID == intervalID
                else {
                    _ = try? await runtime.telemetryCommand(id: UUID(), action: "stop", payload: auth.payload)
                    authorization = nil
                    return
                }
                apply(result)
            } catch {
                if let auth = authorization {
                    try? runtime.setTelemetryPermit(authorizationID: auth.id, bindingID: auth.bindingID, enabled: false)
                    _ = try? await runtime.telemetryCommand(id: UUID(), action: "stop", payload: auth.payload)
                }
                authorization = nil
                isCollecting = false
                if generation == token {
                    manualStatus =
                        (error as? LocalHarnessRuntime.TelemetryFailure)?.errorDescription
                        ?? (error as? LocalHarnessRuntime.Failure)?.errorDescription
                        ?? "Source activation failed. Check selection and current EOF, then authorize again."
                }
            }
        }
    }

    /// Called at the recording boundary before any storage await. No further read is scheduled.
    func canPreview(bindingID: UUID) -> Bool {
        automatic.canPreview(bindingID: bindingID)
            || (isCollecting && authorization?.bindingID == bindingID)
    }

    func stopReading() {
        automatic.stop()
        stopSelectedSource()
    }

    func stopSelectedSource() {
        guard isCollecting || isBusy || authorization != nil else { return }
        let token = UUID()
        generation = token
        isCollecting = false
        manualStatus = "Stopped — authorize a source again for a new interval"
        if let auth = authorization {
            do {
                try runtime.setTelemetryPermit(authorizationID: auth.id, bindingID: auth.bindingID, enabled: false)
            } catch {
                manualStatus =
                    "Source stop could not be confirmed — no further reads requested; retry Stop source reads."
            }
        }
        let earlier = operation
        isBusy = true
        operation = Task {
            await earlier?.value
            if let auth = authorization {
                do {
                    _ = try await runtime.telemetryCommand(id: UUID(), action: "stop", payload: auth.payload)
                } catch {
                    manualStatus =
                        "Stopped in this app — helper stop unconfirmed. No further reads requested; authorization expires within 3 minutes."
                }
            }
            authorization = nil
            if generation == token { isBusy = false }
        }
    }

    /// Delivery keeps running independently after this read gate closes.
    func readIfAuthorized() async {
        await automatic.pollOnce()
        guard !isBusy, isCollecting, let auth = authorization, let recording else { return }
        guard recording.acceptingEvents, recording.current?.id == auth.recordingID,
            recording.current?.activeIntervalID == auth.intervalID, Date() < auth.endsAt
        else {
            let expired = Date() >= auth.endsAt
            stopReading()
            await waitForIdle()
            if expired { manualStatus = "Expired — explicit source authorization required" }
            return
        }
        guard recording.canAct else { return }
        let token = generation
        isBusy = true
        operation = Task {
            defer { if generation == token { isBusy = false } }
            do {
                let result = try await runtime.telemetryCommand(id: UUID(), action: "read", payload: auth.payload)
                if generation == token { apply(result) }
            } catch {
                if generation == token {
                    isCollecting = false
                    manualStatus =
                        "Source read failed or helper restarted — authorize explicitly to continue. Queued observations remain available."
                }
            }
        }
        await operation?.value
    }

    func waitForSelectedSourceIdle() async { await operation?.value }

    func waitForIdle() async {
        await operation?.value
        await automatic.waitForIdle()
    }

    func revoke(bindingID: UUID) {
        automatic.revoke(bindingID: bindingID)
        if authorization?.bindingID == bindingID { stopReading() }
    }

    private func apply(_ result: LocalHarnessRuntime.TelemetryReaderStatus) {
        isCollecting = result.enabled
        let collectingStates = ["selected", "caught_up", "partial_line", "read_limit"]
        if result.enabled && collectingStates.contains(result.status) {
            manualStatus = "Collecting selected source · 3-minute / 2 MiB limit · partial coverage"
        } else if result.status == "window_ended" || result.status == "byte_limit" {
            manualStatus = "Expired (\(result.status)) — explicit source authorization required"
        } else {
            isCollecting = false
            manualStatus = "Stopped (\(result.status)) — check the source and authorize explicitly to continue"
        }
    }
}
