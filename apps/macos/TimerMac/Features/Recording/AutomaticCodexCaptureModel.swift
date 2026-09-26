import AppKit
import Darwin
import Foundation
import Observation

/// A remembered directory is a preference. Only an explicit recording action creates process consent.
@MainActor
@Observable
final class AutomaticCodexCaptureModel {
    var includeCodexActivity = false {
        didSet {
            if includeCodexActivity { recordingDidActivate() } else { stop() }
        }
    }
    var port = 43872
    private var appServerDiscoveryEnabled = false
    var useAppServerDiscovery: Bool {
        get { appServerDiscoveryEnabled }
        set {
            guard canChangeDiscoveryMode else { return }
            appServerDiscoveryEnabled = newValue
            loadedSessionCount = nil
            inScopeSessionCount = nil
        }
    }
    private(set) var directoryName: String
    private(set) var status = "Inactive — Codex activity is off"
    private(set) var isCollecting = false
    private(set) var isBusy = false
    private(set) var sourceCount = 0
    private(set) var loadedSessionCount: Int?
    private(set) var inScopeSessionCount: Int?
    private(set) var isChoosingDirectory = false
    @ObservationIgnored var directoryPicker: (@MainActor () async -> URL?)?
    @ObservationIgnored private weak var recording: RecordingModel?
    @ObservationIgnored private let runtime: LocalHarnessRuntime
    @ObservationIgnored private let preferences: UserDefaults
    @ObservationIgnored private var bookmark: Data?
    @ObservationIgnored private var selectedURL: URL?
    @ObservationIgnored private var scopedURL: URL?
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var poller: Task<Void, Never>?
    @ObservationIgnored private var consent: Consent?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var armed = false
    @ObservationIgnored private var bindings: Set<UUID> = []
    @ObservationIgnored private var pendingBundles: [String: CodexIntakeContract.PairingBundle] = [:]

    private struct Consent {
        let id: UUID
        let runnerID: UUID
        let recordingID: UUID
        let intervalID: UUID
        var payload: Data {
            Data("{\"authorizationID\":\"\(id.uuidString.lowercased())\"}".utf8)
        }
    }

    init(recording: RecordingModel, runtime: LocalHarnessRuntime, preferences: UserDefaults = .standard) {
        self.recording = recording
        self.runtime = runtime
        self.preferences = preferences
        bookmark = preferences.data(forKey: "codexCaptureDirectoryBookmark")
        directoryName = preferences.string(forKey: "codexCaptureDirectoryName") ?? "No directory authorized"
    }

    var hasDirectory: Bool { selectedURL != nil || bookmark != nil }
    var hasState: Bool { hasDirectory || includeCodexActivity || status.hasPrefix("Stopped") }
    var canChangeDiscoveryMode: Bool {
        !armed && !isCollecting && !isBusy && !isChoosingDirectory
            && recording?.current?.status != .recording
    }

    /// A suggested location only: no existence check, enumeration or authorization.
    private var suggestedSessionDirectory: URL? {
        if let codexHome = ProcessInfo.processInfo.environment["CODEX_HOME"], codexHome.hasPrefix("/") {
            return URL(fileURLWithPath: codexHome, isDirectory: true)
                .appendingPathComponent("sessions", isDirectory: true)
        }
        // The sandbox's Foundation home URL can point inside the app container.
        guard let home = getpwuid(getuid())?.pointee.pw_dir else { return nil }
        return URL(fileURLWithPath: String(cString: home), isDirectory: true)
            .appendingPathComponent(".codex/sessions", isDirectory: true)
    }

    func chooseDirectory() {
        guard !isBusy, !isCollecting, !isChoosingDirectory else { return }
        isChoosingDirectory = true
        Task {
            defer { isChoosingDirectory = false }
            let url: URL?
            if let directoryPicker {
                url = await directoryPicker()
            } else {
                let panel = NSOpenPanel()
                panel.title = "Authorize Codex session directory"
                panel.message =
                    "Usually ~/.codex/sessions. Authorize this directory or choose another session directory. Reading begins only with an opted-in recording."
                panel.directoryURL = selectedURL ?? suggestedSessionDirectory
                panel.showsHiddenFiles = true
                panel.prompt = "Authorize directory"
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.allowsMultipleSelection = false
                panel.canCreateDirectories = false
                url = await panel.begin() == .OK ? panel.url : nil
            }
            guard let url else { return }
            do { try authorizeDirectory(url, remember: directoryPicker == nil) } catch {
                status = "Failure — directory authorization could not be saved. Choose it again."
            }
        }
    }

    /// Synthetic callers opt out of persistence. This does not enumerate or read session files.
    func authorizeDirectory(_ url: URL, remember: Bool = true) throws {
        guard !isCollecting, !isBusy, url.isFileURL else { return }
        if remember {
            let data = try url.bookmarkData(
                options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess], includingResourceValuesForKeys: nil,
                relativeTo: nil)
            preferences.set(data, forKey: "codexCaptureDirectoryBookmark")
            preferences.set(url.lastPathComponent, forKey: "codexCaptureDirectoryName")
            bookmark = data
        }
        selectedURL = url
        directoryName = url.lastPathComponent
        status = "Inactive — directory authorized; enable Include Codex activity and start recording"
    }

    func recordingDidActivate() {
        guard includeCodexActivity, hasDirectory, recording?.acceptingEvents == true else { return }
        recording?.telemetry.stopSelectedSource()
        armed = true
        guard poller == nil else { return }
        poller = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.pollOnce()
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
            }
        }
    }

    func restart() {
        guard includeCodexActivity, hasDirectory, recording?.acceptingEvents == true else { return }
        stop()
        let stopped = operation
        let token = generation
        Task {
            await stopped?.value
            guard generation == token else { return }
            recordingDidActivate()
        }
    }

    func recordingDidFinish() {
        includeCodexActivity = false
        appServerDiscoveryEnabled = false
    }

    /// Runs synchronously at Pause/Finish, before native storage can suspend.
    func canPreview(bindingID: UUID) -> Bool {
        armed && includeCodexActivity && isCollecting && bindings.contains(bindingID)
    }

    func stop() {
        armed = false
        generation = UUID()
        poller?.cancel()
        poller = nil
        isCollecting = false
        let old = consent
        if (old != nil || isBusy) && !status.hasPrefix("Failure") {
            status = "Stopped — Resume with Include Codex activity for a fresh baseline"
        }
        if let old {
            do {
                try runtime.setDirectoryTelemetryPermit(authorizationID: old.id, runnerID: old.runnerID, enabled: false)
            } catch { status = "Failure — stop fence unavailable; source lease expires within 15 seconds" }
        }
        let earlier = operation
        let token = generation
        isBusy = old != nil || earlier != nil
        operation = Task {
            await earlier?.value
            if let old {
                _ = try? await runtime.telemetryCommand(id: UUID(), action: "directoryStop", payload: old.payload)
            }
            if generation == token {
                consent = nil
                bindings.removeAll()
                pendingBundles.removeAll()
                scopedURL?.stopAccessingSecurityScopedResource()
                scopedURL = nil
                isBusy = false
            }
        }
    }

    func revokeDirectory() {
        recording?.discardLiveTelemetry(bindingIDs: bindings)
        stop()
        includeCodexActivity = false
        selectedURL = nil
        bookmark = nil
        directoryName = "No directory authorized"
        preferences.removeObject(forKey: "codexCaptureDirectoryBookmark")
        preferences.removeObject(forKey: "codexCaptureDirectoryName")
        status = "Stopped — directory authorization revoked"
    }

    func revoke(bindingID: UUID) {
        if bindings.contains(bindingID) { stop() }
    }

    func waitForIdle() async { await operation?.value }

    func pollOnce() async {
        guard !isBusy, armed, includeCodexActivity, let recording,
            recording.acceptingEvents, let current = recording.current, let intervalID = current.activeIntervalID
        else { return }
        let token = generation
        isBusy = true
        operation = Task {
            defer { if generation == token { isBusy = false } }
            do {
                guard generation == token, armed, recording.acceptingEvents else { return }
                await recording.telemetry.waitForSelectedSourceIdle()
                guard generation == token, armed, recording.acceptingEvents,
                    recording.current?.activeIntervalID == intervalID
                else { return }
                let runnerID = try runtime.telemetryRunnerID()
                if let existing = consent, existing.runnerID != runnerID {
                    // A new helper process must receive fresh native consent and fresh grants.
                    consent = nil
                    bindings.removeAll()
                    pendingBundles.removeAll()
                    sourceCount = 0
                    loadedSessionCount = nil
                    inScopeSessionCount = nil
                }
                let auth: Consent
                var result: LocalHarnessRuntime.TelemetryReaderStatus
                if let existing = consent {
                    auth = existing
                    guard auth.recordingID == current.id, auth.intervalID == intervalID else {
                        stop()
                        return
                    }
                    try runtime.setDirectoryTelemetryPermit(authorizationID: auth.id, runnerID: runnerID, enabled: true)
                    result = try await runtime.telemetryCommand(
                        id: UUID(), action: "directoryRead", payload: auth.payload)
                } else {
                    status = "Authorizing Codex activity…"
                    let url = try resolveDirectory()
                    auth = Consent(id: UUID(), runnerID: runnerID, recordingID: current.id, intervalID: intervalID)
                    consent = auth
                    try runtime.setDirectoryTelemetryPermit(authorizationID: auth.id, runnerID: runnerID, enabled: true)
                    var selection = ["directoryPath": url.path]
                    if useAppServerDiscovery { selection["discoveryMode"] = "appServer" }
                    let payload = try JSONSerialization.data(withJSONObject: selection)
                    result = try await runtime.telemetryCommand(
                        id: auth.id, action: "directoryActivate", payload: payload)
                }
                guard valid(auth, token: token) else { return }
                if !result.enabled {
                    apply(result)
                    return
                }
                for candidate in result.candidates ?? [] {
                    guard valid(auth, token: token) else { return }
                    // Reads and lease renewal depend on active consent, not the native write gate.
                    // A delayed prior-interval ACK can hold that gate without revoking this interval.
                    guard recording.canAct else {
                        apply(result)
                        return
                    }
                    do {
                        let bundle: CodexIntakeContract.PairingBundle
                        if let pending = pendingBundles[candidate.sourceID] {
                            bundle = pending
                        } else {
                            bundle = try await recording.pairLocalCodex(
                                senderID: "wellspent-selected-telemetry", threadID: candidate.threadID,
                                endpoint: "http://127.0.0.1:\(port)")
                            pendingBundles[candidate.sourceID] = bundle
                        }
                        guard valid(auth, token: token) else { return }
                        bindings.insert(bundle.binding.bindingID)
                        try runtime.setDirectoryTelemetryPermit(
                            authorizationID: auth.id, runnerID: runnerID, enabled: true)
                        let payload: [String: Any] = [
                            "authorizationID": auth.id.uuidString.lowercased(), "sourceID": candidate.sourceID,
                            "bundle": try JSONSerialization.jsonObject(with: JSONEncoder().encode(bundle)),
                        ]
                        result = try await runtime.telemetryCommand(
                            id: UUID(), action: "directoryEnroll",
                            payload: JSONSerialization.data(withJSONObject: payload))
                        guard valid(auth, token: token) else { return }
                        pendingBundles.removeValue(forKey: candidate.sourceID)
                        if !result.enabled {
                            apply(result)
                            return
                        }
                    } catch let failure as LocalHarnessRuntime.TelemetryFailure {
                        let isolated: Set<String> = [
                            "source_permission", "source_replaced", "source_unavailable", "source_changed",
                            "unsupported_source_version", "invalid_source_header", "header_limit", "invalid_eof",
                        ]
                        guard isolated.contains(failure.code) else { throw failure }
                        pendingBundles.removeValue(forKey: candidate.sourceID)
                    }
                }
                guard valid(auth, token: token) else { return }
                try runtime.setDirectoryTelemetryPermit(authorizationID: auth.id, runnerID: runnerID, enabled: true)
                result = try await runtime.telemetryCommand(
                    id: UUID(), action: "directoryDiscover", payload: auth.payload)
                guard valid(auth, token: token) else { return }
                apply(result)
            } catch {
                guard generation == token else { return }
                isCollecting = false
                // Only helper process loss is recoverable without another recording action.
                if (error as? LocalHarnessRuntime.Failure) == .devServerUnavailable {
                    status = "Stopped — waiting for helper; active recording consent required to reconnect"
                } else {
                    armed = false
                    if let auth = consent {
                        try? runtime.setDirectoryTelemetryPermit(
                            authorizationID: auth.id, runnerID: auth.runnerID, enabled: false)
                    }
                    let failure = error as? LocalHarnessRuntime.TelemetryFailure
                    status =
                        apiFailureMessage(failure?.code) ?? failure?.errorDescription
                        ?? "Failure — Codex capture stopped. Check directory access and restart capture."
                }
            }
        }
        await operation?.value
    }

    private func valid(_ auth: Consent, token: UUID) -> Bool {
        generation == token && armed && includeCodexActivity && recording?.acceptingEvents == true
            && recording?.current?.id == auth.recordingID && recording?.current?.activeIntervalID == auth.intervalID
    }

    private func resolveDirectory() throws -> URL {
        if let selectedURL { return selectedURL }
        guard let bookmark else { throw LocalHarnessRuntime.Failure.invalidConnection }
        var stale = false
        let url = try URL(
            resolvingBookmarkData: bookmark, options: [.withSecurityScope, .withoutUI, .withoutMounting],
            relativeTo: nil, bookmarkDataIsStale: &stale)
        guard !stale, url.startAccessingSecurityScopedResource() else {
            throw LocalHarnessRuntime.Failure.invalidConnection
        }
        scopedURL = url
        return url
    }

    private func apply(_ result: LocalHarnessRuntime.TelemetryReaderStatus) {
        sourceCount =
            result.sources?.filter {
                $0.bindingID != nil && (result.discoveryMode != "appServer" || $0.enabled)
            }.count ?? 0
        loadedSessionCount = result.loadedSessionCount
        inScopeSessionCount = result.inScopeSessionCount
        isCollecting = result.enabled
        if !result.enabled {
            armed = false
            status =
                apiFailureMessage(result.status)
                ?? (result.status.contains("expired") || result.status == "window_ended"
                    ? "Expired — restart capture for a fresh authorization"
                    : "Stopped (\(result.status)) — restart capture for fresh baselines")
        } else {
            let sourceFailures =
                result.sources?.filter {
                    !$0.enabled && $0.status != "awaiting_binding" && $0.status != "not_loaded"
                }.count ?? 0
            let exclusions = (result.counts ?? [:]).filter { $0.value > 0 }.keys.sorted()
            let discovery = result.discoveryMode == "appServer" || useAppServerDiscovery ? " via Codex API" : ""
            if !exclusions.isEmpty || sourceFailures > 0 || result.status != "collecting" {
                let reasons = exclusions.isEmpty ? result.status : exclusions.joined(separator: ", ")
                status =
                    "Collecting Codex activity\(discovery) · \(sourceCount) sessions · partial coverage · source limitations: \(reasons)"
            } else {
                status = "Collecting Codex activity\(discovery) · \(sourceCount) sessions · partial coverage"
            }
            if result.discoveryMode == "appServer", sourceCount == 0, exclusions.isEmpty {
                status =
                    "Waiting — Codex API found \(loadedSessionCount ?? 0) loaded sessions; \(inScopeSessionCount ?? 0) inside the authorized directory"
            }
        }
    }

    private func apiFailureMessage(_ code: String?) -> String? {
        switch code {
        case "api_unavailable":
            "Failure — Codex API is unavailable. Open Codex with a running local server, then restart capture."
        case "api_timeout":
            "Failure — Codex API did not respond in time. Check Codex, then restart capture."
        case "api_protocol":
            "Failure — Codex API returned an unsupported response. Check the installed Codex version."
        case "api_session_limit":
            "Failure — Codex API exceeded the loaded session limit. Close unused Codex sessions, then restart capture."
        case "api_response_limit":
            "Failure — Codex API exceeded the response size limit. Capture stopped without importing history."
        case "api_source_missing":
            "Failure — Codex API could not identify a session file inside the authorized directory. Check the directory selection."
        default: nil
        }
    }
}
