import Foundation

/// Immutable local evidence. Boundary IDs also serve as command idempotency keys.
struct RecordingEvent: Codable, Equatable, Sendable, Identifiable {
    enum Kind: String, Codable, Sendable {
        case start, pause, resume, finish, suspend, interrupt
        case application, agentCompletion, note

        var isObservation: Bool { self == .application || self == .agentCompletion || self == .note }
    }

    enum TimeBasis: String, Codable, Sendable { case receiver, sourceReported }

    struct Stamp: Codable, Equatable, Sendable {
        let wall: Date
        let uptime: TimeInterval
        let processID: UUID
    }

    struct FocusLink: Codable, Equatable, Sendable {
        let backend: String
        let accountID: UUID
        let sessionID: UUID
    }

    /// The deliberately small live-capture choice made at recording start.
    /// Window titles, document paths, screen contents, input, and network data are never fields here.
    enum CaptureConfiguration: String, Codable, Sendable {
        case foregroundApplicationOnly
    }

    /// A foreground application identity at the time macOS reported an activation transition.
    struct ApplicationIdentity: Codable, Equatable, Sendable {
        let bundleIdentifier: String?
        let localizedName: String?
        let processIdentifier: Int32

        var disclosure: String {
            let name = localizedName ?? "Unnamed application"
            if let bundleIdentifier { return "\(name) (\(bundleIdentifier))" }
            return "\(name) (bundle identifier unavailable)"
        }

        func validate() throws {
            guard processIdentifier >= 0,
                bundleIdentifier?.utf8.count ?? 0 <= 300,
                localizedName?.utf8.count ?? 0 <= 300
            else { throw RecordingError.invalidEvent }
        }
    }

    let id: UUID
    let schemaVersion: Int
    let localScopeID: String
    let recordingID: UUID
    let intervalID: UUID?
    let kind: Kind
    let stamp: Stamp
    let occurredAt: Date?
    let timeBasis: TimeBasis
    let text: String
    let focusLink: FocusLink?
    let captureConfiguration: CaptureConfiguration?
    let applicationIdentity: ApplicationIdentity?

    init(
        id: UUID = UUID(), localScopeID: String, recordingID: UUID, intervalID: UUID?, kind: Kind,
        stamp: Stamp, occurredAt: Date? = nil, timeBasis: TimeBasis = .receiver,
        text: String = "", focusLink: FocusLink? = nil,
        captureConfiguration: CaptureConfiguration? = nil,
        applicationIdentity: ApplicationIdentity? = nil, schemaVersion: Int = 1
    ) {
        self.id = id
        self.schemaVersion = schemaVersion
        self.localScopeID = localScopeID
        self.recordingID = recordingID
        self.intervalID = intervalID
        self.kind = kind
        self.stamp = stamp
        self.occurredAt = occurredAt
        self.timeBasis = timeBasis
        self.text = text
        self.focusLink = focusLink
        self.captureConfiguration = captureConfiguration
        self.applicationIdentity = applicationIdentity
    }

    var sourceLabel: String {
        switch kind {
        case .application:
            applicationIdentity == nil ? "Synthetic application observation" : "Foreground application"
        case .agentCompletion: "Synthetic agent report"
        case .note: "User note"
        default: "Recording boundary"
        }
    }

    func validate() throws {
        guard schemaVersion == 1 else { throw RecordingError.unsupportedSchema }
        guard !localScopeID.isEmpty, localScopeID.utf8.count <= 200, text.utf8.count <= 16_384,
            stamp.wall.timeIntervalSince1970.isFinite, stamp.uptime.isFinite, stamp.uptime >= 0,
            occurredAt?.timeIntervalSince1970.isFinite != false,
            (timeBasis == .sourceReported) == (occurredAt != nil),
            kind.isObservation || (timeBasis == .receiver && occurredAt == nil),
            kind == .start || focusLink == nil,
            kind == .start || captureConfiguration == nil,
            kind == .application || applicationIdentity == nil
        else { throw RecordingError.invalidEvent }
        try applicationIdentity?.validate()
    }
}
