import CryptoKit
import Foundation

/// Local-only metadata contract. Keys always come from committed native pairing state.
enum CodexIntakeContract {
    enum Failure: String, Error, Equatable, Sendable {
        case invalidPacket, untrustedSender, invalidAssociation, expiredBinding, outsideInterval
        case interruptedInterval, awaitingIntervalEnd, identityConflict
    }

    struct Binding: Codable, Equatable, Sendable {
        let bindingID: UUID
        let senderID: String
        let localScopeID: String
        let recordingID: UUID
        let intervalID: UUID
        let threadID: String
    }

    /// Comes from receiver-owned pairing state, never from a poll response or event itself.
    struct Grant: Codable, Sendable {
        let binding: Binding
        let key: Data
        let issuedAt: Date
        let acceptUntil: Date
        let endpoint: String
        var revoked = false
    }

    struct Packet: Codable, Equatable, Sendable {
        let body: Data
        let mac: Data
    }

    struct Metadata: Codable, Equatable, Sendable {
        let version: Int
        let eventID: UUID
        let senderID: String
        let bindingID: UUID
        let localScopeID: String
        let recordingID: UUID
        let intervalID: UUID
        let threadID: String
        let turnID: String
        let invocationID: String
        let kind: String
        let hookReceivedAt: String
        let occurredAt: String?
        let timeBasis: String
        let toolName: String?
        let reportedResult: String

        var stableID: UUID? {
            let fields = ["wellspent-local-codex-v1", senderID, threadID, kind, invocationID]
            let hash = SHA256.hash(data: Data(fields.joined(separator: "\0").utf8))
            var bytes = Array(hash.prefix(16))
            bytes[6] = (bytes[6] & 0x0f) | 0x80
            bytes[8] = (bytes[8] & 0x0f) | 0xa0
            let hex = bytes.map { String(format: "%02x", $0) }
            let uuid = [hex[0..<4], hex[4..<6], hex[6..<8], hex[8..<10], hex[10..<16]]
                .map { $0.joined() }.joined(separator: "-")
            return UUID(uuidString: uuid)
        }
    }

    struct PairingBundle: Codable, Sendable {
        struct BoundInterval: Codable, Sendable {
            let bindingID: UUID
            let senderID: String
            let localScopeID: String
            let recordingID: UUID
            let intervalID: UUID
            let threadID: String
            let issuedAt: String
            let acceptUntil: String

            enum CodingKeys: String, CodingKey {
                case bindingID, senderID, localScopeID, recordingID, intervalID, threadID, issuedAt, acceptUntil
            }

            func encode(to encoder: any Encoder) throws {
                var values = encoder.container(keyedBy: CodingKeys.self)
                try values.encode(bindingID.uuidString.lowercased(), forKey: .bindingID)
                try values.encode(senderID, forKey: .senderID)
                try values.encode(localScopeID, forKey: .localScopeID)
                try values.encode(recordingID.uuidString.lowercased(), forKey: .recordingID)
                try values.encode(intervalID.uuidString.lowercased(), forKey: .intervalID)
                try values.encode(threadID, forKey: .threadID)
                try values.encode(issuedAt, forKey: .issuedAt)
                try values.encode(acceptUntil, forKey: .acceptUntil)
            }
        }
        let version: Int
        let endpoint: String
        let key: Data
        let binding: BoundInterval

        init(grant: Grant) {
            version = 1
            endpoint = grant.endpoint
            key = grant.key
            let b = grant.binding
            binding = .init(
                bindingID: b.bindingID, senderID: b.senderID, localScopeID: b.localScopeID,
                recordingID: b.recordingID, intervalID: b.intervalID, threadID: b.threadID,
                issuedAt: timestamp(grant.issuedAt), acceptUntil: timestamp(grant.acceptUntil))
        }
    }

    typealias StoredMetadata = CodexAgentMetadata

    static func digest(_ body: Data) -> String {
        SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
    }

    static func validID(_ value: String) -> Bool {
        value.range(of: "^[a-zA-Z0-9_-]{1,256}$", options: .regularExpression) != nil
    }

    static func validEndpoint(_ value: String) -> Bool {
        guard let url = URLComponents(string: value), url.scheme == "http", url.host == "127.0.0.1",
            let port = url.port, (1024...65535).contains(port), url.user == nil, url.password == nil,
            url.query == nil, url.fragment == nil, url.path.isEmpty,
            value == "http://127.0.0.1:\(port)"
        else { return false }
        return true
    }

    struct Receipt: Codable, Equatable, Sendable {
        let eventID: UUID
        let bodyDigest: String
        let nativeReceivedAt: String

        enum CodingKeys: String, CodingKey { case eventID, bodyDigest, nativeReceivedAt }

        func encode(to encoder: any Encoder) throws {
            var values = encoder.container(keyedBy: CodingKeys.self)
            try values.encode(eventID.uuidString.lowercased(), forKey: .eventID)
            try values.encode(bodyDigest, forKey: .bodyDigest)
            try values.encode(nativeReceivedAt, forKey: .nativeReceivedAt)
        }
    }

    static func sign(_ body: Data, key: Data, domain: String = "event") -> Packet {
        let message = Data("wellspent-c3a-\(domain)\0".utf8) + body
        return Packet(
            body: body, mac: Data(HMAC<SHA256>.authenticationCode(for: message, using: SymmetricKey(data: key))))
    }

    static func timestamp(_ value: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: value)
    }

    static func date(_ value: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else {
            throw Failure.invalidPacket
        }
        return date
    }

    static func decode(_ packet: Packet, grant: Grant) throws -> Metadata {
        guard !grant.revoked, grant.key.count == 32,
            HMAC<SHA256>.isValidAuthenticationCode(
                packet.mac, authenticating: Data("wellspent-c3a-event\0".utf8) + packet.body,
                using: SymmetricKey(data: grant.key))
        else { throw Failure.untrustedSender }
        let metadata = try parseMetadata(packet.body)
        let binding = grant.binding
        guard metadata.senderID == binding.senderID else { throw Failure.untrustedSender }
        guard metadata.bindingID == binding.bindingID, metadata.localScopeID == binding.localScopeID,
            metadata.recordingID == binding.recordingID, metadata.intervalID == binding.intervalID,
            metadata.threadID == binding.threadID
        else { throw Failure.invalidAssociation }
        return metadata
    }
    /// A permanent rejection may concern schema or association, so it cannot depend on the
    /// rejected full decoder succeeding. Only authentic bytes identifying this binding can
    /// nominate a pending packet; the helper also compares the exact-body digest before moving it.
    static func rejectionIdentity(_ packet: Packet, grant: Grant) -> UUID? {
        guard !grant.revoked, grant.key.count == 32, packet.body.count <= 8192,
            HMAC<SHA256>.isValidAuthenticationCode(
                packet.mac, authenticating: Data("wellspent-c3a-event\0".utf8) + packet.body,
                using: SymmetricKey(data: grant.key)),
            let fields = try? JSONSerialization.jsonObject(with: packet.body) as? [String: Any],
            let bindingText = fields["bindingID"] as? String,
            let bindingID = UUID(uuidString: bindingText), bindingID == grant.binding.bindingID,
            let eventText = fields["eventID"] as? String, let eventID = UUID(uuidString: eventText)
        else { return nil }
        return eventID
    }

    static func parseMetadata(_ body: Data) throws -> Metadata {
        guard body.count <= 8192,
            let fields = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            Set(fields.keys)
                == Set([
                    "version", "eventID", "senderID", "bindingID", "localScopeID", "recordingID", "intervalID",
                    "threadID", "turnID", "invocationID", "kind", "hookReceivedAt", "occurredAt", "timeBasis",
                    "toolName", "reportedResult",
                ])
        else { throw Failure.invalidPacket }
        let metadata: Metadata
        do { metadata = try JSONDecoder().decode(Metadata.self, from: body) } catch {
            throw Failure.invalidPacket
        }
        guard metadata.version == 1,
            [metadata.senderID, metadata.threadID, metadata.turnID, metadata.invocationID].allSatisfy({
                $0.range(of: "^[a-zA-Z0-9_-]{1,256}$", options: .regularExpression) != nil
            }),
            ["PostToolUse", "Stop"].contains(metadata.kind),
            ["success", "failure", "unknown"].contains(metadata.reportedResult),
            metadata.timeBasis == "hookReceived", metadata.occurredAt == nil,
            metadata.stableID == metadata.eventID,
            metadata.kind != "Stop" || (metadata.invocationID == metadata.turnID && metadata.toolName == nil),
            metadata.kind != "PostToolUse"
                || metadata.toolName?.range(of: "^[a-zA-Z0-9_.:-]{1,160}$", options: .regularExpression) != nil
        else { throw Failure.invalidPacket }
        _ = try date(metadata.hookReceivedAt)
        return metadata
    }

}

/// Typed review fields plus exact authenticated bytes. The digest and bytes are immutable evidence,
/// never displayed as prose and never bridged into the cloud capture API.
struct CodexAgentMetadata: Codable, Equatable, Sendable {
    let metadata: CodexIntakeContract.Metadata
    let exactBody: Data
    let bodyDigest: String

    var hookReceivedAt: Date? { try? CodexIntakeContract.date(metadata.hookReceivedAt) }

    func validate(event: RecordingEvent) throws {
        guard exactBody.count <= 8192, bodyDigest == CodexIntakeContract.digest(exactBody),
            let decoded = try? CodexIntakeContract.parseMetadata(exactBody),
            decoded == metadata, metadata.stableID == event.id, metadata.eventID == event.id,
            metadata.recordingID == event.recordingID, metadata.intervalID == event.intervalID,
            metadata.localScopeID == event.localScopeID, hookReceivedAt != nil,
            metadata.occurredAt == nil, metadata.timeBasis == "hookReceived",
            event.kind == .agentCompletion, event.timeBasis == .hookReceived, event.occurredAt == nil,
            event.text.isEmpty
        else { throw RecordingError.invalidEvent }
    }
}
