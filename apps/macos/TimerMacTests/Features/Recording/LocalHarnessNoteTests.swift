import Foundation
import Testing

@testable import TimerMac

@MainActor
struct LocalHarnessNoteTests {
    private let epoch = UUID()
    private let connection = LocalHarnessContract.Connection(
        version: 1, connectionID: UUID(), key: Data(repeating: 7, count: 32),
        endpoint: "http://127.0.0.1:43872", localScopeID: "local", revoked: false)

    @Test
    func committedNoteSurvivesLostAcknowledgementAndAppRestartExactlyOnce() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let clock = RecordingModelClockFixture()
        let model = RecordingModel(repository: repository, localScopeID: "local", stamp: clock.stamp)
        await start(model)
        let request = try packet(model)
        let first = try await model.receiveWorkNote(request, connection: connection, epoch: epoch)
        #expect(first.kind == .note)
        #expect(first.sourceLabel.contains("reported note"))
        #expect(first.agentMetadata == nil)
        #expect(first.workNote?.exactBody == request.body)
        // No helper ACK is sent. Terminate the repository and recover through a new model/process epoch.
        await repository.close()
        let recovered = RecordingModel(
            repository: SQLiteRecordingRepository(url: fixture.url), localScopeID: "local", stamp: clock.stamp)
        recovered.load()
        await recovered.waitForIdle()
        #expect(recovered.current?.status == .interrupted)
        let retry = try await recovered.receiveWorkNote(request, connection: connection, epoch: UUID())
        #expect(retry == first)
        let saved = try #require(recovered.current)
        #expect(saved.events.filter { $0.id == first.id }.count == 1)
        let entry = try #require(
            RecordingTimeline(recording: saved).intervals.first?.entries.first { $0.id == first.id })
        #expect(entry.timeSource == .noteSubmission)
        #expect(entry.timelineTime == first.workNote?.reportedAt)
        #expect(await recovered.shutdown())
    }

    @Test(arguments: ["pause", "suspend", "finish", "resume"])
    func inactiveOrReplacedIntervalCannotAdmitPendingNote(transition: String) async throws {
        let repository = RecordingModelRepositoryFixture()
        let clock = RecordingModelClockFixture()
        let model = RecordingModel(repository: repository, localScopeID: "local", stamp: clock.stamp)
        await start(model)
        let request = try packet(model)
        switch transition {
        case "pause", "resume": model.pause()
        case "suspend": model.suspendForLifecycle(reason: "Test suspension")
        case "finish": model.finish()
        default: model.simulateGap()
        }
        await model.waitForIdle()
        if transition == "resume" {
            model.resume()
            await model.waitForIdle()
        }
        await #expect(throws: LocalHarnessContract.Failure.inactiveInterval) {
            try await model.receiveWorkNote(request, connection: connection, epoch: epoch)
        }
        #expect(model.recordings.flatMap(\.events).contains { $0.workNote != nil } == false)
        #expect(await model.shutdown())
    }

    @Test
    func invalidScopeEpochTimeSignatureAndRevocationAreRejected() async throws {
        let repository = RecordingModelRepositoryFixture()
        let clock = RecordingModelClockFixture()
        let model = RecordingModel(repository: repository, localScopeID: "local", stamp: clock.stamp)
        await start(model)
        let request = try packet(model)
        await #expect(throws: LocalHarnessContract.Failure.expiredRequest) {
            try await model.receiveWorkNote(request, connection: connection, epoch: UUID())
        }
        let wrongScope = try packet(model, scope: "other")
        await #expect(throws: LocalHarnessContract.Failure.wrongScope) {
            try await model.receiveWorkNote(wrongScope, connection: connection, epoch: epoch)
        }
        let expired = try packet(model, age: 60)
        await #expect(throws: LocalHarnessContract.Failure.expiredRequest) {
            try await model.receiveWorkNote(expired, connection: connection, epoch: epoch)
        }
        let invalidSignature = CodexIntakeContract.Packet(body: request.body, mac: Data(repeating: 0, count: 32))
        await #expect(throws: LocalHarnessContract.Failure.invalidPacket) {
            try await model.receiveWorkNote(invalidSignature, connection: connection, epoch: epoch)
        }
        let revoked = LocalHarnessContract.Connection(
            version: 1, connectionID: connection.connectionID, key: connection.key, endpoint: connection.endpoint,
            localScopeID: connection.localScopeID, revoked: true)
        await #expect(throws: LocalHarnessContract.Failure.revoked) {
            try await model.receiveWorkNote(request, connection: revoked, epoch: epoch)
        }
        #expect(model.current?.events.contains { $0.workNote != nil } == false)
        #expect(await model.shutdown())
    }

    @Test
    func sameIdentityWithDifferentTextCannotOverwriteEvidence() async throws {
        let repository = RecordingModelRepositoryFixture()
        let clock = RecordingModelClockFixture()
        let model = RecordingModel(repository: repository, localScopeID: "local", stamp: clock.stamp)
        await start(model)
        let id = UUID()
        let request = try packet(model, id: id)
        let first = try await model.receiveWorkNote(request, connection: connection, epoch: epoch)
        let changed = try packet(model, id: id, text: "Changed text")
        await #expect(throws: LocalHarnessContract.Failure.identityConflict) {
            try await model.receiveWorkNote(changed, connection: connection, epoch: epoch)
        }
        #expect(model.current?.events.filter { $0.id == id } == [first])
        #expect(await model.shutdown())
    }

    @Test
    func lifecycleSuspensionDrainsAnAlreadyAdmittedNoteBeforeClosingCoverage() async throws {
        let repository = RecordingModelRepositoryFixture()
        let clock = RecordingModelClockFixture()
        let model = RecordingModel(repository: repository, localScopeID: "local", stamp: clock.stamp)
        await start(model)
        let request = try packet(model)
        await repository.holdNextCommit()
        let intake = Task { try await model.receiveWorkNote(request, connection: connection, epoch: epoch) }
        await repository.waitUntilCommitHeld()
        model.suspendForLifecycle(reason: "Sleep after admission")
        await repository.releaseCommit()
        let saved = try await intake.value
        #expect(model.current?.status == .suspended)
        #expect(model.current?.events.suffix(2).map(\.kind) == [.note, .suspend])
        #expect(model.current?.events.first { $0.id == saved.id } == saved)
        // An already admitted commit drains before the suspension boundary; later requests are excluded.
        let later = try packet(model)
        await #expect(throws: LocalHarnessContract.Failure.inactiveInterval) {
            try await model.receiveWorkNote(later, connection: connection, epoch: epoch)
        }
        #expect(await model.shutdown())
    }

    private func start(_ model: RecordingModel) async {
        model.load()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
    }

    private func packet(
        _ model: RecordingModel, id: UUID = UUID(), text: String = "Synthetic explicit note: review the next step",
        scope: String = "local", age: TimeInterval = 0
    ) throws -> CodexIntakeContract.Packet {
        let current = try #require(model.current ?? model.recordings.first)
        let interval = try #require(current.intervals.last)
        let note = LocalHarnessContract.Note(
            version: 1, connectionID: connection.connectionID, eventID: id, text: text,
            reportedAt: CodexIntakeContract.timestamp(interval.start.wall.addingTimeInterval(0.1 - age)),
            epoch: epoch, localScopeID: scope, recordingID: current.id, intervalID: interval.id)
        return CodexIntakeContract.sign(try JSONEncoder().encode(note), key: connection.key, domain: "harness-note")
    }
}
