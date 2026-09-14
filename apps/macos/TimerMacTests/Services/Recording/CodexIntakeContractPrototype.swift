import CryptoKit
import Foundation

@testable import TimerMac

/// C3a executable specification, deliberately linked only into tests. No listener or live hooks.
enum CodexIntakeContractPrototype {
    enum Failure: Error, Equatable {
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
        var revoked = false
    }

    struct Packet: Codable, Equatable, Sendable {
        let body: Data
        let mac: Data
    }

    struct Metadata: Codable, Sendable {
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

    struct Receipt: Codable, Equatable, Sendable {
        let eventID: UUID
        let bodyDigest: String
        let nativeReceivedAt: String
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
        guard packet.body.count <= 8192,
            let fields = try JSONSerialization.jsonObject(with: packet.body) as? [String: Any],
            Set(fields.keys)
                == Set([
                    "version", "eventID", "senderID", "bindingID", "localScopeID", "recordingID", "intervalID",
                    "threadID", "turnID", "invocationID", "kind", "hookReceivedAt", "occurredAt", "timeBasis",
                    "toolName", "reportedResult",
                ])
        else { throw Failure.invalidPacket }
        let metadata = try JSONDecoder().decode(Metadata.self, from: packet.body)
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
        let binding = grant.binding
        guard metadata.senderID == binding.senderID else { throw Failure.untrustedSender }
        guard metadata.bindingID == binding.bindingID, metadata.localScopeID == binding.localScopeID,
            metadata.recordingID == binding.recordingID, metadata.intervalID == binding.intervalID,
            metadata.threadID == binding.threadID
        else { throw Failure.invalidAssociation }
        return metadata
    }

    /// The packet's exact bytes are retained in the existing text field only in this synthetic proof.
    /// C3b promotes this to optional typed metadata; it must preserve this deduplication/receipt contract.
    static func receive(
        _ packet: Packet, grant: Grant, stamp: RecordingEvent.Stamp, repository: SQLiteRecordingRepository
    ) async throws -> Packet {
        let metadata = try decode(packet, grant: grant)
        let hookTime = try date(metadata.hookReceivedAt)
        let snapshots = try await repository.load()
        if let original = snapshots.flatMap(\.events).first(where: { $0.id == metadata.eventID }) {
            return try await acknowledge(original, packet: packet, grant: grant, repository: repository)
        }
        guard stamp.wall <= grant.acceptUntil else { throw Failure.expiredBinding }
        guard let snapshot = snapshots.first(where: { $0.id == metadata.recordingID }),
            snapshot.localScopeID == metadata.localScopeID,
            let interval = snapshot.intervals.first(where: { $0.id == metadata.intervalID }),
            grant.issuedAt >= interval.start.wall,
            hookTime >= grant.issuedAt, hookTime >= interval.start.wall, hookTime <= stamp.wall
        else { throw Failure.invalidAssociation }
        guard !interval.interrupted else { throw Failure.interruptedInterval }
        guard let end = interval.end else { throw Failure.awaitingIntervalEnd }
        // Half-open coverage excludes events exactly at pause/finish and wall-clock regressions.
        guard end.wall >= interval.start.wall, grant.issuedAt < end.wall, hookTime < end.wall else {
            throw Failure.outsideInterval
        }
        let event = RecordingEvent(
            id: metadata.eventID, localScopeID: metadata.localScopeID, recordingID: metadata.recordingID,
            intervalID: metadata.intervalID, kind: .agentCompletion, stamp: stamp,
            occurredAt: hookTime, timeBasis: .sourceReported, text: packet.body.base64EncodedString())
        do {
            return try await acknowledge(event, packet: packet, grant: grant, repository: repository)
        } catch RecordingError.conflictingIdentity {
            // Concurrent deliveries can race the initial load. SQLite still owns atomic identity.
            guard
                let original = try await repository.load().flatMap(\.events).first(where: { $0.id == metadata.eventID })
            else { throw Failure.identityConflict }
            return try await acknowledge(original, packet: packet, grant: grant, repository: repository)
        }
    }

    private static func acknowledge(
        _ event: RecordingEvent, packet: Packet, grant: Grant, repository: SQLiteRecordingRepository
    ) async throws -> Packet {
        guard event.kind == .agentCompletion, event.text == packet.body.base64EncodedString() else {
            throw Failure.identityConflict
        }
        // Also on retry: cross the durable repository boundary before issuing any acknowledgement.
        let saved = try await repository.commit(event)
        guard saved.events.contains(event) else { throw RecordingError.invalidStore }
        let receipt = Receipt(
            eventID: event.id, bodyDigest: SHA256.hash(data: packet.body).map { String(format: "%02x", $0) }.joined(),
            nativeReceivedAt: timestamp(event.stamp.wall))
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return sign(try encoder.encode(receipt), key: grant.key, domain: "ack")
    }
}
