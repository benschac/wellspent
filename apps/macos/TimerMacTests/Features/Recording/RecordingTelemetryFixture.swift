import Foundation
import Testing

@testable import TimerMac

/// Synthetic metadata enters only a unique temporary SQLite store through the real native admission path.
struct RecordingTelemetryFixture {
    let store: RecordingStoreFixture
    let repository: SQLiteRecordingRepository
    let secondIntervalID: UUID
    let otherRecordingID: UUID
    let otherIntervalID: UUID
    let packets: [(packet: CodexIntakeContract.Packet, bindingID: UUID)]
    var recordingID: UUID { store.recordingID }
    var firstIntervalID: UUID { store.intervalID }

    static func make() async throws -> Self {
        let store = try RecordingStoreFixture()
        let repository = SQLiteRecordingRepository(url: store.url)
        do {
            let secondIntervalID = UUID()
            let otherRecordingID = UUID()
            let otherIntervalID = UUID()
            func event(_ kind: RecordingEvent.Kind, at seconds: TimeInterval, recording: UUID, interval: UUID)
                -> RecordingEvent
            {
                RecordingEvent(
                    localScopeID: "local", recordingID: recording, intervalID: interval, kind: kind,
                    stamp: store.event(.start, at: seconds).stamp,
                    text: kind == .start
                        ? (recording == store.recordingID
                            ? "Synthetic Codex telemetry review" : "Synthetic response-only recording")
                        : "")
            }
            func grant(recording: UUID, interval: UUID, at seconds: TimeInterval) async throws
                -> CodexIntakeContract.Grant
            {
                let bundle = try await repository.issueCodexGrant(
                    senderID: "synthetic-review", threadID: "synthetic-\(interval.uuidString)",
                    recordingID: recording, localScopeID: "local", intervalID: interval,
                    issuedAt: store.event(.start, at: seconds).stamp.wall, endpoint: "http://127.0.0.1:43187")
                return try #require(
                    try await repository.codexGrants().first {
                        $0.binding.bindingID == bundle.binding.bindingID
                    })
            }
            _ = try await repository.commit(
                event(.start, at: 0, recording: store.recordingID, interval: store.intervalID))
            let first = try await grant(recording: store.recordingID, interval: store.intervalID, at: 1)
            _ = try await repository.commit(store.event(.pause, at: 20))
            _ = try await repository.commit(store.event(.resume, at: 30, interval: secondIntervalID))
            let second = try await grant(recording: store.recordingID, interval: secondIntervalID, at: 31)
            _ = try await repository.commit(store.event(.finish, at: 40, interval: secondIntervalID))
            _ = try await repository.commit(
                event(.start, at: 50, recording: otherRecordingID, interval: otherIntervalID))
            let other = try await grant(recording: otherRecordingID, interval: otherIntervalID, at: 51)
            _ = try await repository.commit(
                event(.finish, at: 60, recording: otherRecordingID, interval: otherIntervalID))

            let specs: [(CodexIntakeContract.Grant, String, String?, TimeInterval, String?, String?)] = [
                (first, "turn-1", nil, 2, "gpt-6-sol", "medium"),
                (first, "turn-1", "response-1", 3, nil, nil),
                (first, "turn-2", nil, 4, "gpt-6-astra", "high"),
                (first, "turn-2", "response-2", 5, nil, nil),
                (first, "turn-3", nil, 6, nil, nil),
                (second, "turn-second-interval", nil, 32, "gpt-6-sol", "low"),
                (other, "turn-other-recording", "response-other", 52, nil, nil),
            ]
            let packets = try specs.map { grant, turn, response, seconds, model, effort in
                (
                    packet: try packet(
                        store: store, grant: grant, turn: turn, response: response, at: seconds,
                        model: model, effort: effort, cacheWrite: response == "response-2" ? 40 : nil),
                    bindingID: grant.binding.bindingID
                )
            }
            // Intentionally reverse source order; delivery time is not source-write order.
            for (index, item) in packets.reversed().enumerated() {
                _ = try await repository.receiveCodexTelemetry(
                    item.packet, bindingID: item.bindingID, stamp: store.event(.start, at: 70 + Double(index)).stamp)
            }
            let duplicate = try #require(packets.first)
            _ = try await repository.receiveCodexTelemetry(
                duplicate.packet, bindingID: duplicate.bindingID, stamp: store.event(.start, at: 90).stamp)
            return .init(
                store: store, repository: repository, secondIntervalID: secondIntervalID,
                otherRecordingID: otherRecordingID, otherIntervalID: otherIntervalID, packets: packets)
        } catch {
            await repository.close()
            store.remove()
            throw error
        }
    }

    static func packet(
        store: RecordingStoreFixture, grant: CodexIntakeContract.Grant, turn: String,
        response: String?, at seconds: TimeInterval, model: String? = nil, effort: String? = nil, cacheWrite: Int? = nil
    ) throws -> CodexIntakeContract.Packet {
        let binding = grant.binding
        let usage: Any =
            response == nil
            ? NSNull()
            : [
                "inputTokens": 1200, "cachedInputTokens": 800, "cacheWriteInputTokens": cacheWrite as Any? ?? NSNull(),
                "outputTokens": 90, "reasoningOutputTokens": 30, "totalTokens": 1290,
            ] as [String: Any]
        var fields: [String: Any] = [
            "version": 1, "observationID": UUID().uuidString, "senderID": binding.senderID,
            "bindingID": binding.bindingID.uuidString, "localScopeID": binding.localScopeID,
            "recordingID": binding.recordingID.uuidString, "intervalID": binding.intervalID.uuidString,
            "source": "codex-rollout", "sourceVersion": "0.157.1", "threadID": binding.threadID,
            "sessionID": "synthetic-session", "rootTurnID": "synthetic-root", "turnID": turn,
            "responseID": response as Any? ?? NSNull(),
            "kind": response == nil ? "turnConfiguration" : "responseUsage",
            "sourceWrittenAt": CodexIntakeContract.timestamp(store.event(.start, at: seconds).stamp.wall),
            "helperReceivedAt": CodexIntakeContract.timestamp(store.event(.start, at: seconds + 1).stamp.wall),
            "timeBasis": "sourceWrite", "configuredModel": model as Any? ?? NSNull(),
            "configuredEffort": effort as Any? ?? NSNull(), "usage": usage,
            "counterMode": response == nil ? "none" : "responseIncrement", "coverage": "partial",
        ]
        let draft = try JSONDecoder().decode(
            CodexTelemetryContract.Metadata.self, from: JSONSerialization.data(withJSONObject: fields))
        fields["observationID"] = try #require(draft.stableID).uuidString
        return CodexIntakeContract.sign(
            try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]), key: grant.key,
            domain: "telemetry")
    }
}
