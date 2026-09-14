import CryptoKit
import Foundation

/// Explicit semantic notes use C3's authenticated envelope, but never its delayed hook admission.
enum LocalHarnessContract {
    enum Failure: String, Error, Sendable {
        case invalidPacket, revoked, wrongScope, inactiveInterval, expiredRequest, identityConflict
    }

    struct Connection: Codable, Sendable {
        let version: Int
        let connectionID: UUID
        let key: Data
        let endpoint: String
        let localScopeID: String
        let revoked: Bool

        func validate() throws {
            guard version == 1, key.count == 32, CodexIntakeContract.validEndpoint(endpoint),
                !localScopeID.isEmpty, localScopeID.utf8.count <= 200
            else { throw Failure.invalidPacket }
        }
    }

    struct Active: Codable, Equatable, Sendable {
        let recordingID: UUID
        let intervalID: UUID
        let localScopeID: String
    }

    struct PollResponse: Decodable, Sendable {
        let nonce: String
        let request: CodexIntakeContract.Packet?
        let discovered: Bool
    }

    struct Note: Codable, Equatable, Sendable {
        let version: Int
        let connectionID: UUID
        let eventID: UUID
        let text: String
        let reportedAt: String
        let epoch: UUID
        let localScopeID: String
        let recordingID: UUID
        let intervalID: UUID
    }

    static func decode<Value: Decodable>(
        _ packet: CodexIntakeContract.Packet, key: Data, domain: String, as type: Value.Type
    ) throws -> Value {
        guard key.count == 32, packet.body.count <= 16_384, packet.mac.count == 32,
            HMAC<SHA256>.isValidAuthenticationCode(
                packet.mac, authenticating: Data("wellspent-c3a-\(domain)\0".utf8) + packet.body,
                using: SymmetricKey(data: key))
        else { throw Failure.invalidPacket }
        do { return try JSONDecoder().decode(type, from: packet.body) } catch { throw Failure.invalidPacket }
    }

    static func parseNote(_ body: Data) throws -> Note {
        guard body.count <= 8192,
            let fields = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            Set(fields.keys) == [
                "version", "connectionID", "eventID", "text", "reportedAt", "epoch", "localScopeID",
                "recordingID", "intervalID",
            ], let note = try? JSONDecoder().decode(Note.self, from: body), note.version == 1,
            !note.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, note.text.utf8.count <= 4096,
            !note.localScopeID.isEmpty, note.localScopeID.utf8.count <= 200
        else { throw Failure.invalidPacket }
        _ = try CodexIntakeContract.date(note.reportedAt)
        return note
    }

    static func note(_ packet: CodexIntakeContract.Packet, connection: Connection) throws -> Note {
        try connection.validate()
        guard !connection.revoked else { throw Failure.revoked }
        let _: Note = try decode(packet, key: connection.key, domain: "harness-note", as: Note.self)
        let note = try parseNote(packet.body)
        guard note.connectionID == connection.connectionID else { throw Failure.revoked }
        guard note.localScopeID == connection.localScopeID else { throw Failure.wrongScope }
        return note
    }
}
