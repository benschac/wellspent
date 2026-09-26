import CryptoKit
import Foundation

/// Metadata-only v2 channel. A turn setting never labels a response's execution model.
enum CodexTelemetryContract {
    enum Failure: String, Error, Equatable, Sendable {
        case unsupportedVersion, invalidPacket, untrustedSender, invalidAssociation
        case expiredBinding, outsideInterval, interruptedInterval, awaitingIntervalEnd, identityConflict
    }

    struct Usage: Codable, Equatable, Sendable {
        let inputTokens: Int
        let cachedInputTokens: Int
        let cacheWriteInputTokens: Int?
        let outputTokens: Int
        let reasoningOutputTokens: Int
        let totalTokens: Int

        func valid() -> Bool {
            let values = [inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens]
            guard values.allSatisfy({ $0 >= 0 }), cacheWriteInputTokens.map({ $0 >= 0 }) ?? true,
                inputTokens <= Int.max - outputTokens, inputTokens + outputTokens == totalTokens,
                cachedInputTokens <= inputTokens, reasoningOutputTokens <= outputTokens
            else { return false }
            return cacheWriteInputTokens.map({ $0 <= inputTokens }) ?? true
        }
    }

    struct Metadata: Codable, Equatable, Sendable {
        let version: Int
        let observationID: UUID
        let senderID: String
        let bindingID: UUID
        let localScopeID: String
        let recordingID: UUID
        let intervalID: UUID
        let source: String
        let sourceVersion: String
        let threadID: String
        let sessionID: String
        let rootTurnID: String
        let turnID: String
        let responseID: String?
        let kind: String
        let sourceWrittenAt: String
        let helperReceivedAt: String
        let timeBasis: String
        let configuredModel: String?
        let configuredEffort: String?
        let usage: Usage?
        let counterMode: String
        let coverage: String

        var stableID: UUID? {
            let fields = [
                "wellspent-codex-telemetry-v1", senderID, threadID, sessionID, rootTurnID,
                turnID, kind, responseID ?? "",
            ]
            let hash = SHA256.hash(data: Data(fields.joined(separator: "\0").utf8))
            var bytes = Array(hash.prefix(16))
            bytes[6] = (bytes[6] & 0x0f) | 0x80
            bytes[8] = (bytes[8] & 0x0f) | 0xa0
            let hex = bytes.map { String(format: "%02x", $0) }
            return UUID(
                uuidString: [hex[0..<4], hex[4..<6], hex[6..<8], hex[8..<10], hex[10..<16]]
                    .map { $0.joined() }.joined(separator: "-"))
        }
    }

    struct Receipt: Codable, Equatable, Sendable {
        let observationID: UUID
        let bodyDigest: String
        let nativeReceivedAt: String

        enum CodingKeys: String, CodingKey { case observationID, bodyDigest, nativeReceivedAt }
        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(observationID.uuidString.lowercased(), forKey: .observationID)
            try container.encode(bodyDigest, forKey: .bodyDigest)
            try container.encode(nativeReceivedAt, forKey: .nativeReceivedAt)
        }
    }

    static func parse(_ body: Data) throws -> Metadata {
        guard body.count <= 8192,
            let fields = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
            Set(fields.keys)
                == Set([
                    "version", "observationID", "senderID", "bindingID", "localScopeID", "recordingID",
                    "intervalID", "source", "sourceVersion", "threadID", "sessionID", "rootTurnID", "turnID",
                    "responseID", "kind", "sourceWrittenAt", "helperReceivedAt", "timeBasis", "configuredModel",
                    "configuredEffort", "usage", "counterMode", "coverage",
                ])
        else { throw Failure.invalidPacket }
        guard fields["version"] as? Int == 1 else { throw Failure.unsupportedVersion }
        guard let metadata = try? JSONDecoder().decode(Metadata.self, from: body),
            metadata.observationID == metadata.stableID, metadata.source == "codex-rollout",
            metadata.sourceVersion == "0.157.1", metadata.timeBasis == "sourceWrite",
            metadata.coverage == "partial",
            [metadata.senderID, metadata.threadID, metadata.sessionID, metadata.rootTurnID, metadata.turnID]
                .allSatisfy(CodexIntakeContract.validID),
            !metadata.localScopeID.isEmpty, metadata.localScopeID.utf8.count <= 200,
            !metadata.localScopeID.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
        else { throw Failure.invalidPacket }
        if metadata.kind == "turnConfiguration" {
            guard metadata.responseID == nil, metadata.usage == nil, metadata.counterMode == "none",
                [metadata.configuredModel, metadata.configuredEffort].allSatisfy({ value in
                    value == nil || value?.range(of: "^[a-zA-Z0-9_.-]{1,160}$", options: .regularExpression) != nil
                })
            else { throw Failure.invalidPacket }
        } else if metadata.kind == "responseUsage" {
            guard let responseID = metadata.responseID, CodexIntakeContract.validID(responseID),
                metadata.configuredModel == nil, metadata.configuredEffort == nil,
                metadata.counterMode == "responseIncrement", metadata.usage?.valid() == true,
                let usageFields = fields["usage"] as? [String: Any],
                Set(usageFields.keys)
                    == Set([
                        "inputTokens", "cachedInputTokens", "cacheWriteInputTokens", "outputTokens",
                        "reasoningOutputTokens", "totalTokens",
                    ])
            else { throw Failure.invalidPacket }
        } else {
            throw Failure.invalidPacket
        }
        guard (try? CodexIntakeContract.date(metadata.sourceWrittenAt)) != nil,
            (try? CodexIntakeContract.date(metadata.helperReceivedAt)) != nil
        else { throw Failure.invalidPacket }
        return metadata
    }

    static func decode(_ packet: CodexIntakeContract.Packet, grant: CodexIntakeContract.Grant) throws -> Metadata {
        guard !grant.revoked, grant.key.count == 32,
            HMAC<SHA256>.isValidAuthenticationCode(
                packet.mac, authenticating: Data("wellspent-c3a-telemetry\0".utf8) + packet.body,
                using: SymmetricKey(data: grant.key))
        else { throw Failure.untrustedSender }
        let metadata = try parse(packet.body)
        let binding = grant.binding
        guard metadata.senderID == binding.senderID else { throw Failure.untrustedSender }
        guard metadata.bindingID == binding.bindingID, metadata.localScopeID == binding.localScopeID,
            metadata.recordingID == binding.recordingID, metadata.intervalID == binding.intervalID,
            metadata.threadID == binding.threadID
        else { throw Failure.invalidAssociation }
        return metadata
    }
}
