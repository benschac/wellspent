import CryptoKit
import Foundation
import Testing

@testable import TimerMac

private typealias Contract = CodexIntakeContractPrototype

private struct IntakeFixture {
    struct Vector: Decodable {
        let key: Data
        let binding: Contract.Binding
        let packet: Contract.Packet
    }
    let store: RecordingStoreFixture
    let vector: Vector
    let processID = UUID()
    var grant: Contract.Grant {
        .init(binding: vector.binding, key: vector.key, issuedAt: time(1), acceptUntil: time(1000))
    }
    init() throws {
        store = try RecordingStoreFixture()
        var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0..<5 { root.deleteLastPathComponent() }
        vector = try JSONDecoder().decode(
            Vector.self, from: Data(contentsOf: root.appendingPathComponent("docs/design/probes/c3a/fixture.json")))
    }
    func time(_ seconds: Double) -> Date { Date(timeIntervalSince1970: 1_800_000_000 + seconds) }
    func stamp(_ seconds: Double, restarted: Bool = false) -> RecordingEvent.Stamp {
        .init(wall: time(seconds), uptime: 100 + seconds, processID: restarted ? UUID() : processID)
    }
    func event(_ kind: RecordingEvent.Kind, at seconds: Double, interval: UUID? = nil) -> RecordingEvent {
        .init(
            localScopeID: vector.binding.localScopeID, recordingID: vector.binding.recordingID,
            intervalID: interval ?? vector.binding.intervalID, kind: kind, stamp: stamp(seconds))
    }
    func seed(_ repository: SQLiteRecordingRepository, close: Bool = true) async throws {
        _ = try await repository.commit(event(.start, at: 0))
        if close { _ = try await repository.commit(event(.pause, at: 10)) }
    }
    func packet(changing key: String, to value: Any) throws -> Contract.Packet {
        let body = try #require(try JSONSerialization.jsonObject(with: vector.packet.body) as? [String: Any])
        var changed = body
        changed[key] = value
        return Contract.sign(
            try JSONSerialization.data(withJSONObject: changed, options: [.sortedKeys]), key: vector.key)
    }
}

struct CodexIntakeContractTests {
    @Test
    func nodeFixtureAuthenticatesAndPreservesDistinctTimesAcrossDuplicateAndRestart() async throws {
        let fixture = try IntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        try await fixture.seed(repository)
        let first = try await Contract.receive(
            fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(20), repository: repository)
        // Persist/reload trusted configuration as the C3b native pairing store will do; never take a key from the event.
        let state = fixture.store.directory.appendingPathComponent("synthetic-pairing.json")
        try JSONEncoder().encode(fixture.grant).write(to: state, options: .atomic)
        await repository.close()
        let recoveredGrant = try JSONDecoder().decode(Contract.Grant.self, from: Data(contentsOf: state))
        let reopened = SQLiteRecordingRepository(url: fixture.store.url)
        let retry = try await Contract.receive(
            fixture.vector.packet, grant: recoveredGrant, stamp: fixture.stamp(30, restarted: true),
            repository: reopened)
        #expect(first == retry)
        #expect(first == Contract.sign(first.body, key: fixture.vector.key, domain: "ack"))
        let receipt = try JSONDecoder().decode(Contract.Receipt.self, from: first.body)
        #expect(try Contract.date(receipt.nativeReceivedAt) == fixture.time(20))
        let saved = try #require(try await reopened.load().first)
        #expect(saved.events.count == 3)
        let event = try #require(saved.events.last)
        #expect(event.occurredAt == fixture.time(5))  // source-reported hook receipt, not execution time
        #expect(event.stamp.wall == fixture.time(20))
        #expect(event.intervalID == fixture.vector.binding.intervalID)
        let metadata = try Contract.decode(fixture.vector.packet, grant: recoveredGrant)
        #expect(metadata.occurredAt == nil)
        #expect(metadata.timeBasis == "hookReceived")
        #expect(metadata.reportedResult == "success")
        await reopened.close()
    }

    @Test(arguments: ["beforeWrite", "eventWritten", "committed"])
    func failureNeverAcknowledgesAndRetryAfterReopenUsesOneDurableIdentity(phase: String) async throws {
        let fixture = try IntakeFixture()
        defer { fixture.store.remove() }
        let initial = SQLiteRecordingRepository(url: fixture.store.url)
        try await fixture.seed(initial)
        await initial.close()
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
        await #expect(throws: RecordingInjectedFailure.self) {
            try await Contract.receive(
                fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(20), repository: failing)
        }
        await failing.close()
        let reopened = SQLiteRecordingRepository(url: fixture.store.url)
        #expect(try await reopened.load().first?.events.count == (phase == "committed" ? 3 : 2))
        let ack = try await Contract.receive(
            fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(30, restarted: true), repository: reopened
        )
        let receipt = try JSONDecoder().decode(Contract.Receipt.self, from: ack.body)
        #expect(try Contract.date(receipt.nativeReceivedAt) == fixture.time(phase == "committed" ? 20 : 30))
        #expect(try await reopened.load().first?.events.count == 3)
        await reopened.close()
    }

    @Test
    func concurrentDeliveriesAcknowledgeTheSameCommittedEvent() async throws {
        let fixture = try IntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        try await fixture.seed(repository)
        async let first = Contract.receive(
            fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(20), repository: repository)
        async let second = Contract.receive(
            fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(21), repository: repository)
        let receipts = try await (first, second)
        #expect(receipts.0 == receipts.1)
        #expect(try await repository.load().first?.events.count == 3)
        await repository.close()
    }

    @Test
    func openIntervalDefersAndDelayedDeliveryRetainsTheOldIntervalAfterResumeAndFinish() async throws {
        let fixture = try IntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        try await fixture.seed(repository, close: false)
        await #expect(throws: Contract.Failure.awaitingIntervalEnd) {
            try await Contract.receive(
                fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(6), repository: repository)
        }
        _ = try await repository.commit(fixture.event(.pause, at: 10))
        let next = UUID()
        _ = try await repository.commit(fixture.event(.resume, at: 20, interval: next))
        _ = try await repository.commit(fixture.event(.finish, at: 30, interval: next))
        _ = try await Contract.receive(
            fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(40), repository: repository)
        let saved = try #require(try await repository.load().first)
        #expect(saved.status == .finished)
        #expect(saved.events.last?.intervalID == fixture.vector.binding.intervalID)
        #expect(saved.intervals.map(\.committedDuration) == [10, 10])
        await repository.close()
    }

    @Test
    func offlineReceiverLeavesSenderPacketRetryable() async throws {
        let fixture = try IntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        try await fixture.seed(repository)
        await repository.close()
        let pending = fixture.vector.packet
        await #expect(throws: RecordingError.closed) {
            try await Contract.receive(pending, grant: fixture.grant, stamp: fixture.stamp(20), repository: repository)
        }
        let reopened = SQLiteRecordingRepository(url: fixture.store.url)
        _ = try await Contract.receive(pending, grant: fixture.grant, stamp: fixture.stamp(30), repository: reopened)
        #expect(try await reopened.load().first?.events.count == 3)
        await reopened.close()
    }

    @Test
    func interruptedCoverageIsRejectedAfterRestartAndExplicitResumeDoesNotRebindIt() async throws {
        let fixture = try IntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        try await fixture.seed(repository, close: false)
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.store.url)
        _ = try await reopened.commit(fixture.event(.interrupt, at: 20))
        _ = try await reopened.commit(fixture.event(.resume, at: 30, interval: UUID()))
        await #expect(throws: Contract.Failure.interruptedInterval) {
            try await Contract.receive(
                fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(40), repository: reopened)
        }
        #expect(try await reopened.load().first?.events.count == 3)
        await reopened.close()
    }

    @Test(arguments: [
        "wrongKey", "tamper", "sender", "revoked", "scope", "recording", "interval", "binding", "thread", "expired",
        "unknownStore",
    ])
    func invalidTrustOrAssociationCannotCommit(reason: String) async throws {
        let fixture = try IntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        if reason != "unknownStore" { try await fixture.seed(repository) }
        var packet = fixture.vector.packet
        var grant = fixture.grant
        var expected = Contract.Failure.invalidAssociation
        switch reason {
        case "wrongKey":
            packet = Contract.sign(packet.body, key: Data(repeating: 1, count: 32))
            expected = .untrustedSender
        case "tamper":
            packet = .init(body: packet.body + Data(" ".utf8), mac: packet.mac)
            expected = .untrustedSender
        case "sender":
            packet = try fixture.packet(changing: "senderID", to: "unknown_sender")
            // A forged sender also invalidates the independently computed stable ID.
            expected = .invalidPacket
        case "revoked":
            grant.revoked = true
            expected = .untrustedSender
        case "scope": packet = try fixture.packet(changing: "localScopeID", to: "other")
        case "recording": packet = try fixture.packet(changing: "recordingID", to: UUID().uuidString)
        case "interval": packet = try fixture.packet(changing: "intervalID", to: UUID().uuidString)
        case "binding": packet = try fixture.packet(changing: "bindingID", to: UUID().uuidString)
        case "thread":
            packet = try fixture.packet(changing: "threadID", to: "other")
            expected = .invalidPacket
        case "expired": expected = .expiredBinding
        default: break
        }
        let input = packet
        let trusted = grant
        await #expect(throws: expected) {
            try await Contract.receive(
                input, grant: trusted, stamp: fixture.stamp(reason == "expired" ? 1001 : 20), repository: repository)
        }
        #expect(try await repository.load().flatMap(\.events).count == (reason == "unknownStore" ? 0 : 2))
        await repository.close()
    }

    @Test(arguments: ["before", "atEnd", "after", "future", "malformed", "prose", "occurrence", "identity", "oversize"])
    func outOfScopeMetadataIsRejected(reason: String) async throws {
        let fixture = try IntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        try await fixture.seed(repository)
        let packet: Contract.Packet
        let expected: Contract.Failure
        switch reason {
        case "before":
            packet = try fixture.packet(changing: "hookReceivedAt", to: "2027-01-15T08:00:00.000Z")
            expected = .invalidAssociation
        case "atEnd":
            packet = try fixture.packet(changing: "hookReceivedAt", to: "2027-01-15T08:00:10.000Z")
            expected = .outsideInterval
        case "after":
            packet = try fixture.packet(changing: "hookReceivedAt", to: "2027-01-15T08:00:11.000Z")
            expected = .outsideInterval
        case "future":
            packet = try fixture.packet(changing: "hookReceivedAt", to: "2027-01-15T08:00:21.000Z")
            expected = .invalidAssociation
        case "malformed":
            packet = try fixture.packet(changing: "hookReceivedAt", to: "not-a-date")
            expected = .invalidPacket
        case "prose":
            packet = try fixture.packet(changing: "summary", to: "must not persist")
            expected = .invalidPacket
        case "occurrence":
            packet = try fixture.packet(changing: "occurredAt", to: "2027-01-15T08:00:04.000Z")
            expected = .invalidPacket
        case "identity":
            packet = try fixture.packet(changing: "eventID", to: UUID().uuidString)
            expected = .invalidPacket
        default:
            packet = try fixture.packet(changing: "toolName", to: String(repeating: "x", count: 9000))
            expected = .invalidPacket
        }
        await #expect(throws: expected) {
            try await Contract.receive(packet, grant: fixture.grant, stamp: fixture.stamp(20), repository: repository)
        }
        #expect(try await repository.load().first?.events.count == 2)
        await repository.close()
    }

    @Test
    func changedPayloadConflictsButExactRetryAfterExpiryAcknowledgesOriginal() async throws {
        let fixture = try IntakeFixture()
        defer { fixture.store.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.store.url)
        try await fixture.seed(repository)
        let ack = try await Contract.receive(
            fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(20), repository: repository)
        let changed = try fixture.packet(changing: "reportedResult", to: "failure")
        await #expect(throws: Contract.Failure.identityConflict) {
            try await Contract.receive(changed, grant: fixture.grant, stamp: fixture.stamp(30), repository: repository)
        }
        let retry = try await Contract.receive(
            fixture.vector.packet, grant: fixture.grant, stamp: fixture.stamp(2000), repository: repository)
        #expect(retry == ack)
        #expect(try await repository.load().first?.events.count == 3)
        await repository.close()
    }
}
