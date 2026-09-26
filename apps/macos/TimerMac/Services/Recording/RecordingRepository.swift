import Foundation

protocol RecordingRepository: Sendable {
    func load() async throws -> [RecordingSnapshot]
    func commit(_ event: RecordingEvent) async throws -> RecordingSnapshot
    func delete(_ recordingID: UUID, localScopeID: String) async throws
    func codexGrants() async throws -> [CodexIntakeContract.Grant]
    func issueCodexGrant(
        senderID: String, threadID: String, recordingID: UUID, localScopeID: String,
        intervalID: UUID, issuedAt: Date, endpoint: String
    ) async throws -> CodexIntakeContract.PairingBundle
    func revokeCodexGrant(bindingID: UUID) async throws
    func receiveCodexPacket(
        _ packet: CodexIntakeContract.Packet, bindingID: UUID,
        stamp: RecordingEvent.Stamp
    ) async throws -> CodexIntakeContract.Packet
    func receiveCodexTelemetry(
        _ packet: CodexIntakeContract.Packet, bindingID: UUID,
        stamp: RecordingEvent.Stamp
    ) async throws -> CodexIntakeContract.Packet
    func loadCodexTelemetry(localScopeID: String) async throws -> [CodexTelemetryContract.Metadata]
    func loadCodexTelemetryReview(localScopeID: String, recordingID: UUID, intervalID: UUID) async throws
        -> [RecordingTelemetryObservation]
    func loadTaskAttribution(localScopeID: String) async throws -> RecordingTaskAttribution
    func createTask(_ task: LocalTask) async throws -> LocalTask
    func selectTask(_ selection: RecordingTaskSelection) async throws -> RecordingTaskSelection
    func correctTaskAttribution(_ command: RecordingAttributionCommand) async throws -> RecordingAttributionOperation
    func close() async
}

// Synthetic fixtures and unavailable repositories do not silently enable local intake.
extension RecordingRepository {
    func loadTaskAttribution(localScopeID: String) async throws -> RecordingTaskAttribution { .init() }
    func createTask(_ task: LocalTask) async throws -> LocalTask { throw RecordingError.invalidStore }
    func selectTask(_ selection: RecordingTaskSelection) async throws -> RecordingTaskSelection {
        throw RecordingError.invalidStore
    }
    func correctTaskAttribution(_ command: RecordingAttributionCommand) async throws -> RecordingAttributionOperation {
        throw RecordingError.invalidStore
    }
    func codexGrants() async throws -> [CodexIntakeContract.Grant] { [] }
    func issueCodexGrant(
        senderID: String, threadID: String, recordingID: UUID, localScopeID: String,
        intervalID: UUID, issuedAt: Date, endpoint: String
    ) async throws -> CodexIntakeContract.PairingBundle {
        throw RecordingError.invalidStore
    }
    func revokeCodexGrant(bindingID: UUID) async throws { throw RecordingError.invalidStore }
    func receiveCodexPacket(
        _ packet: CodexIntakeContract.Packet, bindingID: UUID,
        stamp: RecordingEvent.Stamp
    ) async throws -> CodexIntakeContract.Packet {
        throw RecordingError.invalidStore
    }
    func receiveCodexTelemetry(
        _ packet: CodexIntakeContract.Packet, bindingID: UUID,
        stamp: RecordingEvent.Stamp
    ) async throws -> CodexIntakeContract.Packet { throw RecordingError.invalidStore }
    func loadCodexTelemetry(localScopeID: String) async throws -> [CodexTelemetryContract.Metadata] { [] }
    func loadCodexTelemetryReview(localScopeID: String, recordingID: UUID, intervalID: UUID) async throws
        -> [RecordingTelemetryObservation]
    { throw RecordingError.invalidStore }
}
