import Foundation
import Testing

@testable import TimerMac

private struct TelemetryFixture {
    let store: RecordingStoreFixture
    let grant: CodexIntakeContract.Grant

    func packet(kind: String = "responseUsage", response: String = "response_1", total: Int = 23) throws
        -> CodexIntakeContract.Packet
    {
        let binding = grant.binding
        let usage: Any =
            kind == "responseUsage"
            ? [
                "inputTokens": total - 3, "cachedInputTokens": 10, "cacheWriteInputTokens": NSNull(),
                "outputTokens": 3, "reasoningOutputTokens": 1, "totalTokens": total,
            ] as [String: Any] : NSNull()
        var fields: [String: Any] = [
            "version": 1, "observationID": UUID().uuidString, "senderID": binding.senderID,
            "bindingID": binding.bindingID.uuidString, "localScopeID": binding.localScopeID,
            "recordingID": binding.recordingID.uuidString, "intervalID": binding.intervalID.uuidString,
            "source": "codex-rollout", "sourceVersion": "0.157.1", "threadID": binding.threadID,
            "sessionID": "session_1", "rootTurnID": "root_1", "turnID": "turn_1",
            "responseID": kind == "responseUsage" ? response as Any : NSNull(), "kind": kind,
            "sourceWrittenAt": CodexIntakeContract.timestamp(store.event(.start, at: 5).stamp.wall),
            "helperReceivedAt": CodexIntakeContract.timestamp(store.event(.start, at: 6).stamp.wall),
            "timeBasis": "sourceWrite", "configuredModel": kind == "turnConfiguration" ? "gpt-6-sol" as Any : NSNull(),
            "configuredEffort": kind == "turnConfiguration" ? "medium" as Any : NSNull(),
            "usage": usage, "counterMode": kind == "responseUsage" ? "responseIncrement" : "none",
            "coverage": "partial", "privateCanary": "SECRET",
        ]
        // The fixture deliberately drops a private source field before signing.
        fields.removeValue(forKey: "privateCanary")
        let draft = try JSONDecoder().decode(
            CodexTelemetryContract.Metadata.self, from: JSONSerialization.data(withJSONObject: fields))
        fields["observationID"] = try #require(draft.stableID).uuidString
        if kind == "responseUsage", response == "response_1" {
            #expect(draft.stableID?.uuidString.lowercased() == "251f175d-8493-878a-a255-141b37565898")
        }
        return CodexIntakeContract.sign(
            try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
            key: grant.key, domain: "telemetry")
    }
}

struct CodexTelemetryIntakeTests {
    @Test
    func nodeVectorsAuthenticateWithMatchingSwiftContract() throws {
        struct Vector: Decodable {
            let key: Data
            let binding: CodexIntakeContract.Binding
            let configuration: CodexIntakeContract.Packet
            let responseUsage: CodexIntakeContract.Packet
        }
        var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let vector = try JSONDecoder().decode(
            Vector.self,
            from: Data(contentsOf: root.appendingPathComponent("docs/design/probes/c4/telemetry-fixture.json")))
        let grant = CodexIntakeContract.Grant(
            binding: vector.binding, key: vector.key,
            issuedAt: try CodexIntakeContract.date("2027-01-15T08:00:00.000Z"),
            acceptUntil: try CodexIntakeContract.date("2027-01-22T08:00:00.000Z"),
            endpoint: "http://127.0.0.1:43871")
        let config = try CodexTelemetryContract.decode(vector.configuration, grant: grant)
        let usage = try CodexTelemetryContract.decode(vector.responseUsage, grant: grant)
        #expect(config.kind == "turnConfiguration")
        #expect(config.configuredModel == "gpt-6-sol")
        #expect(config.usage == nil)
        #expect(usage.observationID.uuidString.lowercased() == "251f175d-8493-878a-a255-141b37565898")
        #expect(usage.usage?.totalTokens == 23)
        #expect(usage.configuredModel == nil)
        #expect(usage.counterMode == "responseIncrement")
        #expect(String(decoding: vector.responseUsage.body, as: UTF8.self).contains("SECRET") == false)
        #expect(throws: CodexIntakeContract.Failure.invalidPacket) {
            try CodexIntakeContract.parseMetadata(vector.responseUsage.body)
        }
    }

    private func fixture(_ repository: SQLiteRecordingRepository, store: RecordingStoreFixture) async throws
        -> TelemetryFixture
    {
        _ = try await repository.commit(store.event(.start))
        let bundle = try await repository.issueCodexGrant(
            senderID: "sender_test", threadID: "thread_test", recordingID: store.recordingID,
            localScopeID: "local", intervalID: store.intervalID,
            issuedAt: store.event(.start, at: 1).stamp.wall, endpoint: "http://127.0.0.1:43187")
        let grant = try #require(try await repository.codexGrants().first)
        #expect(bundle.binding.bindingID == grant.binding.bindingID)
        return .init(store: store, grant: grant)
    }

    @Test
    func delayedCommitRetryConflictAndReopenPreserveOriginals() async throws {
        let store = try RecordingStoreFixture()
        defer { store.remove() }
        let repository = SQLiteRecordingRepository(url: store.url)
        let context = try await fixture(repository, store: store)
        let packet = try context.packet()
        await #expect(throws: CodexTelemetryContract.Failure.awaitingIntervalEnd) {
            try await repository.receiveCodexTelemetry(
                packet, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 7).stamp)
        }
        _ = try await repository.commit(store.event(.pause, at: 10))
        let originals = try store.sql("SELECT payload FROM recording_events ORDER BY sequence")
        async let first = repository.receiveCodexTelemetry(
            packet, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 20).stamp)
        async let second = repository.receiveCodexTelemetry(
            packet, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 21).stamp)
        let receipts = try await (first, second)
        #expect(receipts.0 == receipts.1)
        let conflict = try context.packet(total: 24)
        await #expect(throws: CodexTelemetryContract.Failure.identityConflict) {
            try await repository.receiveCodexTelemetry(
                conflict, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 22).stamp)
        }
        let configured = try context.packet(kind: "turnConfiguration")
        _ = try await repository.receiveCodexTelemetry(
            configured, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 23).stamp)
        let saved = try await repository.loadCodexTelemetry(localScopeID: "local")
        #expect(saved.count == 2)
        #expect(saved.first?.configuredModel == nil)
        #expect(saved.first?.usage?.totalTokens == 23)
        #expect(saved.last?.configuredModel == "gpt-6-sol")
        #expect(saved.last?.usage == nil)
        #expect(try store.sql("SELECT payload FROM recording_events ORDER BY sequence") == originals)
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: store.url)
        #expect(try await reopened.loadCodexTelemetry(localScopeID: "local") == saved)
        let retry = try await reopened.receiveCodexTelemetry(
            packet, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 700_000).stamp)
        #expect(retry == receipts.0)
        #expect(try store.sql("SELECT payload FROM recording_events ORDER BY sequence") == originals)
        #expect(try store.sql("PRAGMA user_version") == [["3"]])
        await reopened.close()
    }

    @Test
    func unsupportedAndPrivateFieldsFailWithoutARecord() async throws {
        let store = try RecordingStoreFixture()
        defer { store.remove() }
        let repository = SQLiteRecordingRepository(url: store.url)
        let context = try await fixture(repository, store: store)
        let packet = try context.packet()
        var fields = try #require(JSONSerialization.jsonObject(with: packet.body) as? [String: Any])
        fields["version"] = 2
        let unsupported = CodexIntakeContract.sign(
            try JSONSerialization.data(withJSONObject: fields), key: context.grant.key, domain: "telemetry")
        await #expect(throws: CodexTelemetryContract.Failure.unsupportedVersion) {
            try await repository.receiveCodexTelemetry(
                unsupported, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 7).stamp)
        }
        fields["version"] = 1
        fields["privateCanary"] = "SECRET"
        let privatePacket = CodexIntakeContract.sign(
            try JSONSerialization.data(withJSONObject: fields), key: context.grant.key, domain: "telemetry")
        await #expect(throws: CodexTelemetryContract.Failure.invalidPacket) {
            try await repository.receiveCodexTelemetry(
                privatePacket, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 7).stamp)
        }
        #expect(try await repository.loadCodexTelemetry(localScopeID: "local").isEmpty)
        await repository.close()
    }

    @Test(arguments: ["telemetryWritten", "committed"])
    func transactionFailureAndLostAcknowledgementHaveDistinctRetryResults(phase: String) async throws {
        let store = try RecordingStoreFixture()
        defer { store.remove() }
        let seed = SQLiteRecordingRepository(url: store.url)
        let context = try await fixture(seed, store: store)
        _ = try await seed.commit(store.event(.pause, at: 10))
        await seed.close()
        let packet = try context.packet()
        let failing = SQLiteRecordingRepository(
            url: store.url,
            checkpoint: { point in
                if phase == "telemetryWritten" && point == .telemetryWritten
                    || phase == "committed" && point == .committed
                {
                    throw RecordingInjectedFailure.checkpoint
                }
            })
        await #expect(throws: RecordingInjectedFailure.self) {
            try await failing.receiveCodexTelemetry(
                packet, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 20).stamp)
        }
        await failing.close()
        let reopened = SQLiteRecordingRepository(url: store.url)
        #expect(
            try await reopened.loadCodexTelemetry(localScopeID: "local").count
                == (phase == "committed" ? 1 : 0))
        let receipt = try await reopened.receiveCodexTelemetry(
            packet, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 21).stamp)
        let decoded = try JSONDecoder().decode(CodexTelemetryContract.Receipt.self, from: receipt.body)
        #expect(
            decoded.nativeReceivedAt
                == CodexIntakeContract.timestamp(
                    store.event(.start, at: phase == "committed" ? 20 : 21).stamp.wall))
        #expect(try await reopened.loadCodexTelemetry(localScopeID: "local").count == 1)
        await reopened.close()
    }

    @Test
    func pauseAndRestartGapRejectsNewTelemetry() async throws {
        let store = try RecordingStoreFixture()
        defer { store.remove() }
        let repository = SQLiteRecordingRepository(url: store.url)
        let context = try await fixture(repository, store: store)
        _ = try await repository.commit(store.event(.pause, at: 10))
        var fields = try #require(JSONSerialization.jsonObject(with: context.packet().body) as? [String: Any])
        fields["sourceWrittenAt"] = CodexIntakeContract.timestamp(store.event(.start, at: 11).stamp.wall)
        fields["helperReceivedAt"] = CodexIntakeContract.timestamp(store.event(.start, at: 12).stamp.wall)
        let afterPause = CodexIntakeContract.sign(
            try JSONSerialization.data(withJSONObject: fields), key: context.grant.key, domain: "telemetry")
        await #expect(throws: CodexTelemetryContract.Failure.outsideInterval) {
            try await repository.receiveCodexTelemetry(
                afterPause, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 20).stamp)
        }
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: store.url)
        #expect(try await reopened.loadCodexTelemetry(localScopeID: "local").isEmpty)
        await reopened.close()
    }

    @Test
    func interruptedIntervalAndRevocationBlockUncommittedTelemetry() async throws {
        let store = try RecordingStoreFixture()
        defer { store.remove() }
        let repository = SQLiteRecordingRepository(url: store.url)
        let context = try await fixture(repository, store: store)
        let packet = try context.packet()
        _ = try await repository.commit(store.event(.interrupt, at: 10))
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: store.url)
        await #expect(throws: CodexTelemetryContract.Failure.interruptedInterval) {
            try await reopened.receiveCodexTelemetry(
                packet, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 20).stamp)
        }
        try await reopened.revokeCodexGrant(bindingID: context.grant.binding.bindingID)
        await #expect(throws: CodexTelemetryContract.Failure.untrustedSender) {
            try await reopened.receiveCodexTelemetry(
                packet, bindingID: context.grant.binding.bindingID, stamp: store.event(.start, at: 21).stamp)
        }
        #expect(try await reopened.loadCodexTelemetry(localScopeID: "local").isEmpty)
        await reopened.close()
    }

    @Test
    func v2MigrationRollsBackAndReopensWithoutChangingEvidenceOrGrant() async throws {
        let store = try RecordingStoreFixture()
        defer { store.remove() }
        let original = SQLiteRecordingRepository(url: store.url)
        let context = try await fixture(original, store: store)
        let note = store.event(.note, at: 2, text: "Original note")
        _ = try await original.commit(note)
        _ = try await original.commit(store.event(.pause, at: 10))
        let task = LocalTask(localScopeID: "local", title: "Original task", createdAt: note.stamp.wall)
        _ = try await original.createTask(task)
        _ = try await original.correctTaskAttribution(
            .init(
                localScopeID: "local", recordingID: store.recordingID, eventID: note.id,
                assignment: .task(task.id), createdAt: note.stamp.wall.addingTimeInterval(100)))
        let attribution = try await original.loadTaskAttribution(localScopeID: "local")
        await original.close()
        let events = try store.sql("SELECT payload FROM recording_events ORDER BY sequence")
        let grants = try store.sql("SELECT id, hex(payload), revoked FROM codex_grants")
        let tasks = try store.sql("SELECT payload FROM local_tasks")
        let corrections = try store.sql("SELECT payload FROM task_review_operations")
        _ = try store.sql("DROP TABLE codex_telemetry")
        _ = try store.sql("DELETE FROM grdb_migrations WHERE identifier = 'codex-telemetry-v3'")
        _ = try store.sql("PRAGMA user_version = 2")
        let failing = SQLiteRecordingRepository(
            url: store.url,
            checkpoint: { point in
                if point == .telemetryMigrationWritten { throw RecordingInjectedFailure.checkpoint }
            })
        await #expect(throws: RecordingInjectedFailure.self) { try await failing.load() }
        await failing.close()
        #expect(try store.sql("PRAGMA user_version") == [["2"]])
        #expect(try store.sql("SELECT name FROM sqlite_master WHERE name = 'codex_telemetry'").isEmpty)
        #expect(try store.sql("SELECT payload FROM recording_events ORDER BY sequence") == events)
        #expect(try store.sql("SELECT id, hex(payload), revoked FROM codex_grants") == grants)
        #expect(try store.sql("SELECT payload FROM local_tasks") == tasks)
        #expect(try store.sql("SELECT payload FROM task_review_operations") == corrections)
        let reopened = SQLiteRecordingRepository(url: store.url)
        #expect(try await reopened.loadTaskAttribution(localScopeID: "local") == attribution)
        _ = try await reopened.receiveCodexTelemetry(
            context.packet(), bindingID: context.grant.binding.bindingID,
            stamp: store.event(.start, at: 20).stamp)
        #expect(try await reopened.loadCodexTelemetry(localScopeID: "local").count == 1)
        #expect(try store.sql("SELECT payload FROM recording_events ORDER BY sequence") == events)
        #expect(try store.sql("SELECT id, hex(payload), revoked FROM codex_grants") == grants)
        #expect(try store.sql("SELECT payload FROM local_tasks") == tasks)
        #expect(try store.sql("SELECT payload FROM task_review_operations") == corrections)
        #expect(try store.sql("PRAGMA user_version") == [["3"]])
        await reopened.close()
    }
}
