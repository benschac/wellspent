import Foundation
import Testing

@testable import TimerMac

@MainActor
struct LocalCodexModelTests {
    @Test
    func delayedIntakeRefreshesHistoryAndPreservesOriginalReceiptAcrossRetry() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let clock = RecordingModelClockFixture()
        let model = RecordingModel(repository: repository, localScopeID: "local", stamp: clock.stamp)
        model.load()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        let bundle = try await model.pairLocalCodex(
            senderID: "synthetic_sender", threadID: "synthetic_thread", endpoint: "http://127.0.0.1:43871")
        let grant = try #require(try await model.localCodexGrants().first)
        let packet = try packet(grant)
        await #expect(throws: CodexIntakeContract.Failure.awaitingIntervalEnd) {
            try await model.receiveLocalCodex(packet, bindingID: bundle.binding.bindingID)
        }
        #expect(model.errorMessage == nil)
        model.pause()
        await model.waitForIdle()
        let ack = try await model.receiveLocalCodex(packet, bindingID: bundle.binding.bindingID)
        let original = try #require(model.selected?.events.last)
        #expect(original.agentMetadata != nil)
        #expect(original.occurredAt == nil)
        #expect(original.timeBasis == .hookReceived)
        let replay = try await model.receiveLocalCodex(packet, bindingID: bundle.binding.bindingID)
        #expect(replay == ack)
        #expect(model.selected?.events.filter { $0.id == original.id }.count == 1)
        #expect(model.selected?.events.last?.stamp == original.stamp)
        try await model.revokeLocalCodex(bindingID: bundle.binding.bindingID)
        await #expect(throws: CodexIntakeContract.Failure.untrustedSender) {
            try await model.receiveLocalCodex(packet, bindingID: bundle.binding.bindingID)
        }
        #expect(await model.shutdown())
    }

    @Test
    func recoveryInterruptsBeforeAnySavedBindingCanReceiveNewEvidence() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let first = SQLiteRecordingRepository(url: fixture.url)
        let clock = RecordingModelClockFixture()
        let model = RecordingModel(repository: first, localScopeID: "local", stamp: clock.stamp)
        model.load()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        _ = try await model.pairLocalCodex(
            senderID: "synthetic_sender", threadID: "synthetic_thread", endpoint: "http://127.0.0.1:43871")
        let grant = try #require(try await model.localCodexGrants().first)
        let packet = try packet(grant)
        await first.close()  // No orderly recording shutdown: emulate abandoned active history.
        let recovered = RecordingModel(
            repository: SQLiteRecordingRepository(url: fixture.url), localScopeID: "local", stamp: clock.stamp)
        await #expect(throws: RecordingError.invalidTransition) {
            try await recovered.receiveLocalCodex(packet, bindingID: grant.binding.bindingID)
        }
        recovered.load()
        await recovered.waitForIdle()
        #expect(recovered.current?.status == .interrupted)
        await #expect(throws: CodexIntakeContract.Failure.interruptedInterval) {
            try await recovered.receiveLocalCodex(packet, bindingID: grant.binding.bindingID)
        }
        #expect(recovered.current?.events.contains { $0.agentMetadata != nil } == false)
        #expect(await recovered.shutdown())
    }

    private func packet(_ grant: CodexIntakeContract.Grant) throws -> CodexIntakeContract.Packet {
        let binding = grant.binding
        let metadata = CodexIntakeContract.Metadata(
            version: 1, eventID: UUID(), senderID: binding.senderID, bindingID: binding.bindingID,
            localScopeID: binding.localScopeID, recordingID: binding.recordingID, intervalID: binding.intervalID,
            threadID: binding.threadID, turnID: "turn", invocationID: "tool", kind: "PostToolUse",
            hookReceivedAt: CodexIntakeContract.timestamp(grant.issuedAt.addingTimeInterval(0.1)),
            occurredAt: nil, timeBasis: "hookReceived", toolName: "Bash", reportedResult: "success")
        let id = try #require(metadata.stableID)
        var fields = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(metadata)) as? [String: Any])
        fields["eventID"] = id.uuidString
        fields["occurredAt"] = NSNull()
        return CodexIntakeContract.sign(try JSONSerialization.data(withJSONObject: fields), key: grant.key)
    }
}
