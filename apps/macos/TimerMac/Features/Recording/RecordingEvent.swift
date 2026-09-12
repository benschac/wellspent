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

    init(
        id: UUID = UUID(), localScopeID: String, recordingID: UUID, intervalID: UUID?, kind: Kind,
        stamp: Stamp, occurredAt: Date? = nil, timeBasis: TimeBasis = .receiver,
        text: String = "", focusLink: FocusLink? = nil, schemaVersion: Int = 1
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
    }

    var sourceLabel: String {
        switch kind {
        case .application: "Synthetic application observation"
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
            kind == .start || focusLink == nil
        else { throw RecordingError.invalidEvent }
    }
}
