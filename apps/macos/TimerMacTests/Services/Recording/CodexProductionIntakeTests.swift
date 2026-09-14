import Foundation
import Testing

@testable import TimerMac

private typealias ProductionContract = CodexIntakeContract

private struct ProductionIntakeFixture {
    let store: RecordingStoreFixture
    let senderID = "sender_test"
    let threadID = "thread_test"

    init() throws { store = try RecordingStoreFixture() }

    func grant(_ repository: SQLiteRecordingRepository) async throws -> ProductionContract.Grant {
        _ = try await repository.commit(store.event(.start))
        let bundle = try await repository.issueCodexGrant(
            senderID: senderID, threadID: threadID,
            recordingID: store.recordingID, localScopeID: "local", intervalID: store.intervalID,
            issuedAt: store.event(.start, at: 1).stamp.wall, endpoint: "http://127.0.0.1:43187")
        let grants = try await repository.codexGrants()
        let grant = try #require(grants.first)
        #expect(bundle.key.count == 32)
        #expect(bundle.binding.bindingID == grant.binding.bindingID)
        return grant
    }

    func packet(_ grant: ProductionContract.Grant, result: String = "success", at seconds: Double = 5) throws
        -> ProductionContract.Packet
    {
        let binding = grant.binding
        var fields: [String: Any] = [
            "version": 1, "eventID": UUID().uuidString, "senderID": senderID,
            "bindingID": binding.bindingID.uuidString, "localScopeID": binding.localScopeID,
            "recordingID": binding.recordingID.uuidString, "intervalID": binding.intervalID.uuidString,
            "threadID": threadID, "turnID": "turn_test", "invocationID": "tool_test", "kind": "PostToolUse",
            "hookReceivedAt": ProductionContract.timestamp(store.event(.start, at: seconds).stamp.wall),
            "occurredAt": NSNull(), "timeBasis": "hookReceived", "toolName": "exec_command",
            "reportedResult": result,
        ]
        let draft = try JSONDecoder().decode(
            ProductionContract.Metadata.self,
            from: JSONSerialization.data(withJSONObject: fields))
        fields["eventID"] = try #require(draft.stableID).uuidString
        return ProductionContract.sign(
            try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
            key: grant.key)
    }
}

struct CodexProductionIntakeTests {
    @Test
    func durableGrantAndTypedReceiptSurviveRestartAndConcurrentDuplicates() async throws {
        let fixture = try ProductionIntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        let grant = try await fixture.grant(repository)
        let packet = try fixture.packet(grant)
        await #expect(throws: ProductionContract.Failure.awaitingIntervalEnd) {
            try await repository.receiveCodexPacket(
                packet, bindingID: grant.binding.bindingID,
                stamp: fixture.store.event(.start, at: 6).stamp)
        }
        _ = try await repository.commit(fixture.store.event(.pause, at: 10))
        async let first = repository.receiveCodexPacket(
            packet, bindingID: grant.binding.bindingID,
            stamp: fixture.store.event(.start, at: 20).stamp)
        async let second = repository.receiveCodexPacket(
            packet, bindingID: grant.binding.bindingID,
            stamp: fixture.store.event(.start, at: 21).stamp)
        let acks = try await (first, second)
        #expect(acks.0 == acks.1)
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.store.url)
        let recovered = try #require(try await reopened.codexGrants().first)
        #expect(recovered.key == grant.key)
        let retry = try await reopened.receiveCodexPacket(
            packet, bindingID: grant.binding.bindingID,
            stamp: fixture.store.event(.start, at: 700_000).stamp)
        #expect(retry == acks.0)
        let saved = try #require(try await reopened.load().first)
        #expect(saved.events.count == 3)
        let report = try #require(saved.events.last)
        #expect(report.timeBasis == .hookReceived)
        #expect(report.occurredAt == nil)
        #expect(report.text.isEmpty)
        #expect(report.agentMetadata?.exactBody == packet.body)
        #expect(report.agentMetadata?.hookReceivedAt == fixture.store.event(.start, at: 5).stamp.wall)
        let receipt = try JSONDecoder().decode(ProductionContract.Receipt.self, from: retry.body)
        #expect(receipt.nativeReceivedAt == ProductionContract.timestamp(report.stamp.wall))
        await reopened.close()
    }

    @Test(arguments: ["revoke", "delete"])
    func durableRevocationPreventsDuplicatesAndResurrection(action: String) async throws {
        let fixture = try ProductionIntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        let grant = try await fixture.grant(repository)
        _ = try await repository.commit(fixture.store.event(.pause, at: 10))
        let packet = try fixture.packet(grant)
        _ = try await repository.receiveCodexPacket(
            packet, bindingID: grant.binding.bindingID,
            stamp: fixture.store.event(.start, at: 20).stamp)
        if action == "delete" {
            try await repository.delete(fixture.store.recordingID, localScopeID: "local")
        } else {
            try await repository.revokeCodexGrant(bindingID: grant.binding.bindingID)
        }
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.store.url)
        #expect(try await reopened.codexGrants().first?.revoked == true)
        await #expect(throws: ProductionContract.Failure.untrustedSender) {
            try await reopened.receiveCodexPacket(
                packet, bindingID: grant.binding.bindingID,
                stamp: fixture.store.event(.start, at: 30).stamp)
        }
        #expect(try await reopened.load().count == (action == "delete" ? 0 : 1))
        await reopened.close()
    }

    @Test(arguments: ["beforeWrite", "eventWritten", "committed"])
    func failedCommitNeverReturnsAckAndReopenPreservesFirstReceipt(phase: String) async throws {
        let fixture = try ProductionIntakeFixture()
        defer { fixture.store.remove() }
        let seed = SQLiteRecordingRepository(url: fixture.store.url)
        let grant = try await fixture.grant(seed)
        _ = try await seed.commit(fixture.store.event(.pause, at: 10))
        await seed.close()
        let failing = SQLiteRecordingRepository(
            url: fixture.store.url,
            checkpoint: { point in
                if (phase == "beforeWrite" && point == .beforeWrite)
                    || (phase == "eventWritten" && point == .eventWritten)
                    || (phase == "committed" && point == .committed)
                {
                    throw RecordingInjectedFailure.checkpoint
                }
            })
        let packet = try fixture.packet(grant)
        await #expect(throws: RecordingInjectedFailure.self) {
            try await failing.receiveCodexPacket(
                packet, bindingID: grant.binding.bindingID,
                stamp: fixture.store.event(.start, at: 20).stamp)
        }
        await failing.close()
        let reopened = SQLiteRecordingRepository(url: fixture.store.url)
        let ack = try await reopened.receiveCodexPacket(
            packet, bindingID: grant.binding.bindingID,
            stamp: fixture.store.event(.start, at: 30).stamp)
        let receipt = try JSONDecoder().decode(ProductionContract.Receipt.self, from: ack.body)
        #expect(
            receipt.nativeReceivedAt
                == ProductionContract.timestamp(
                    fixture.store.event(.start, at: phase == "committed" ? 20 : 30).stamp.wall))
        #expect(try await reopened.load().first?.events.count == 3)
        await reopened.close()
    }

    @Test
    func identityConflictPreservesOriginalAndNewIntervalNeedsNewBinding() async throws {
        let fixture = try ProductionIntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        let grant = try await fixture.grant(repository)
        _ = try await repository.commit(fixture.store.event(.pause, at: 10))
        let original = try fixture.packet(grant)
        _ = try await repository.receiveCodexPacket(
            original, bindingID: grant.binding.bindingID,
            stamp: fixture.store.event(.start, at: 20).stamp)
        let changed = try fixture.packet(grant, result: "failure")
        await #expect(throws: ProductionContract.Failure.identityConflict) {
            try await repository.receiveCodexPacket(
                changed, bindingID: grant.binding.bindingID,
                stamp: fixture.store.event(.start, at: 30).stamp)
        }
        await #expect(throws: ProductionContract.Failure.invalidAssociation) {
            try await repository.issueCodexGrant(
                senderID: fixture.senderID, threadID: fixture.threadID,
                recordingID: fixture.store.recordingID, localScopeID: "local", intervalID: fixture.store.intervalID,
                issuedAt: fixture.store.event(.start, at: 30).stamp.wall, endpoint: "http://127.0.0.1:43187")
        }
        _ = try await repository.commit(fixture.store.event(.resume, at: 40, interval: UUID()))
        #expect(try await repository.load().first?.events.filter { $0.agentMetadata != nil }.count == 1)
        await repository.close()
    }

    @Test(arguments: ["malformed", "unknownKey", "occurrence", "atEnd", "beforeBinding", "future", "badMAC"])
    func invalidMetadataAndCoverageCannotCommit(reason: String) async throws {
        let fixture = try ProductionIntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        let grant = try await fixture.grant(repository)
        _ = try await repository.commit(fixture.store.event(.pause, at: 10))
        let valid = try fixture.packet(grant)
        var fields = try #require(try JSONSerialization.jsonObject(with: valid.body) as? [String: Any])
        var expected = ProductionContract.Failure.invalidPacket
        switch reason {
        case "unknownKey": fields["assistantText"] = "excluded"
        case "occurrence":
            fields["occurredAt"] = ProductionContract.timestamp(fixture.store.event(.start, at: 4).stamp.wall)
        case "atEnd":
            fields["hookReceivedAt"] = ProductionContract.timestamp(fixture.store.event(.start, at: 10).stamp.wall)
            expected = .outsideInterval
        case "beforeBinding":
            fields["hookReceivedAt"] = ProductionContract.timestamp(fixture.store.event(.start).stamp.wall)
            expected = .invalidAssociation
        case "future":
            fields["hookReceivedAt"] = ProductionContract.timestamp(fixture.store.event(.start, at: 21).stamp.wall)
            expected = .invalidAssociation
        case "badMAC": expected = .untrustedSender
        default: break
        }
        let body = reason == "malformed" ? Data("{".utf8) : try JSONSerialization.data(withJSONObject: fields)
        let packet = ProductionContract.sign(body, key: reason == "badMAC" ? Data(repeating: 0, count: 32) : grant.key)
        await #expect(throws: expected) {
            try await repository.receiveCodexPacket(
                packet, bindingID: grant.binding.bindingID,
                stamp: fixture.store.event(.start, at: 20).stamp)
        }
        #expect(try await repository.load().first?.events.count == 2)
        await repository.close()
    }

    @Test
    func grantFilesArePrivateAndMalformedRecoveredStateFailsClosed() async throws {
        let fixture = try ProductionIntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        _ = try await fixture.grant(repository)
        let file = try FileManager.default.attributesOfItem(atPath: fixture.store.url.path)
        let directory = try FileManager.default.attributesOfItem(atPath: fixture.store.directory.path)
        #expect((file[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        #expect((directory[.posixPermissions] as? NSNumber)?.intValue == 0o700)
        await repository.close()
        _ = try fixture.store.sql("UPDATE codex_grants SET payload = X'00'")
        let reopened = SQLiteRecordingRepository(url: fixture.store.url)
        await #expect(throws: (any Error).self) { try await reopened.codexGrants() }
        await reopened.close()
    }

    @Test
    func unknownCrashCoverageCannotAttachToAResumedInterval() async throws {
        let fixture = try ProductionIntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        let grant = try await fixture.grant(repository)
        let packet = try fixture.packet(grant)
        _ = try await repository.commit(fixture.store.event(.interrupt, at: 20))
        _ = try await repository.commit(fixture.store.event(.resume, at: 30, interval: UUID()))
        await #expect(throws: ProductionContract.Failure.interruptedInterval) {
            try await repository.receiveCodexPacket(
                packet, bindingID: grant.binding.bindingID,
                stamp: fixture.store.event(.start, at: 40).stamp)
        }
        #expect(try await repository.load().first?.events.count == 3)
        await repository.close()
    }

    @Test
    func bundleAndReceiptUseLowercaseWireUUIDs() throws {
        let binding = ProductionContract.Binding(
            bindingID: UUID(), senderID: "sender", localScopeID: "local",
            recordingID: UUID(), intervalID: UUID(), threadID: "thread")
        let grant = ProductionContract.Grant(
            binding: binding, key: Data(repeating: 1, count: 32),
            issuedAt: Date(timeIntervalSince1970: 0), acceptUntil: Date(timeIntervalSince1970: 604800),
            endpoint: "http://127.0.0.1:43187")
        let bundle = try JSONEncoder().encode(ProductionContract.PairingBundle(grant: grant))
        let object = try #require(try JSONSerialization.jsonObject(with: bundle) as? [String: Any])
        let fields = try #require(object["binding"] as? [String: Any])
        #expect(fields["bindingID"] as? String == binding.bindingID.uuidString.lowercased())
        #expect(fields["recordingID"] as? String == binding.recordingID.uuidString.lowercased())
        #expect(fields["intervalID"] as? String == binding.intervalID.uuidString.lowercased())
        let receipt = ProductionContract.Receipt(
            eventID: binding.bindingID, bodyDigest: "digest", nativeReceivedAt: "time")
        let ack = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(receipt)) as? [String: Any])
        #expect(ack["eventID"] as? String == binding.bindingID.uuidString.lowercased())
    }

    @Test
    func submillisecondIssuanceMatchesBundleWithoutRetroactiveCoverage() async throws {
        let fixture = try ProductionIntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        _ = try await repository.commit(fixture.store.event(.start, at: 1.0003))
        let supplied = fixture.store.event(.start, at: 1.0004).stamp.wall
        let bundle = try await repository.issueCodexGrant(
            senderID: fixture.senderID, threadID: fixture.threadID,
            recordingID: fixture.store.recordingID, localScopeID: "local", intervalID: fixture.store.intervalID,
            issuedAt: supplied, endpoint: "http://127.0.0.1:43187")
        let grant = try #require(try await repository.codexGrants().first)
        #expect(grant.issuedAt >= supplied)
        #expect(grant.issuedAt.timeIntervalSince(supplied) < 0.001)
        #expect(try ProductionContract.date(bundle.binding.issuedAt) == grant.issuedAt)
        #expect(try ProductionContract.date(bundle.binding.acceptUntil) == grant.acceptUntil)
        await repository.close()
    }

    @Test(arguments: ["scope", "schema", "badMAC", "otherBinding"])
    func permanentRejectionUsesAuthenticatedIdentityWithoutAcceptingMetadata(reason: String) async throws {
        let fixture = try ProductionIntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        let grant = try await fixture.grant(repository)
        let valid = try fixture.packet(grant)
        let original = try ProductionContract.decode(valid, grant: grant)
        var fields = try #require(try JSONSerialization.jsonObject(with: valid.body) as? [String: Any])
        switch reason {
        case "scope": fields["localScopeID"] = "wrong"
        case "schema": fields["unknownField"] = "excluded"
        case "otherBinding": fields["bindingID"] = UUID().uuidString
        default: break
        }
        let packet = ProductionContract.sign(
            try JSONSerialization.data(withJSONObject: fields),
            key: reason == "badMAC" ? Data(repeating: 0, count: 32) : grant.key)
        #expect(throws: ProductionContract.Failure.self) { try ProductionContract.decode(packet, grant: grant) }
        let rejected = ProductionContract.rejectionIdentity(packet, grant: grant)
        #expect(rejected == (reason == "scope" || reason == "schema" ? original.eventID : nil))
        await repository.close()
    }

    @Test(arguments: [
        "http://localhost:43187", "https://127.0.0.1:43187", "http://127.0.0.1:43187/",
        "http://127.0.0.1:43187?proxy=1", "http://127.0.0.1:80",
    ])
    func endpointCannotBroadenTrust(endpoint: String) {
        #expect(ProductionContract.validEndpoint(endpoint) == false)
    }
}
