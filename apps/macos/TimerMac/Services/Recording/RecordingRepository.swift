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
    func close() async
}

// Synthetic fixtures and unavailable repositories do not silently enable local intake.
extension RecordingRepository {
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
}
