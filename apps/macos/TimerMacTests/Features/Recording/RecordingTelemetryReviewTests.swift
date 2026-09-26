import Foundation
import Testing

@testable import TimerMac

@MainActor
struct RecordingTelemetryReviewTests {
    @Test
    func scopedReviewPreservesBytesReceiptsAndOrderAfterReopen() async throws {
        let fixture = try await RecordingTelemetryFixture.make()
        defer { fixture.store.remove() }
        let repository = fixture.repository
        let before = try fixture.store.sql("SELECT id, hex(body), hex(receipt) FROM codex_telemetry ORDER BY rowid")
        let events = try fixture.store.sql("SELECT payload FROM recording_events ORDER BY sequence")
        let first = try await repository.loadCodexTelemetryReview(
            localScopeID: "local", recordingID: fixture.recordingID, intervalID: fixture.firstIntervalID)
        #expect(first.count == 5)
        #expect(first.map(\.metadata.turnID) == ["turn-1", "turn-1", "turn-2", "turn-2", "turn-3"])
        #expect(first.map(\.sourceWrittenAt) == first.map(\.sourceWrittenAt).sorted())
        #expect(
            first.filter { $0.metadata.kind == "turnConfiguration" }.map(\.metadata.configuredModel)
                == ["gpt-6-sol", "gpt-6-astra", nil])
        #expect(first.last?.metadata.usage == nil)
        #expect(first.allSatisfy { $0.metadata.coverage == "partial" })
        let usage = try #require(first.first { $0.metadata.responseID == "response-1" })
        #expect(usage.metadata.configuredModel == nil)
        #expect(usage.metadata.usage?.cacheWriteInputTokens == nil)
        #expect(usage.metadata.usage?.totalTokens == 1290)
        let secondUsage = try #require(first.first { $0.metadata.responseID == "response-2" })
        #expect(secondUsage.metadata.usage?.cacheWriteInputTokens == 40)
        #expect(secondUsage.metadata.usage?.totalTokens == 1290)
        #expect(usage.nativeReceivedAt > usage.sourceWrittenAt)
        #expect(
            first.first?.receipt.nativeReceivedAt
                == CodexIntakeContract.timestamp(fixture.store.event(.start, at: 76).stamp.wall))
        let second = try await repository.loadCodexTelemetryReview(
            localScopeID: "local", recordingID: fixture.recordingID, intervalID: fixture.secondIntervalID)
        #expect(second.map(\.metadata.turnID) == ["turn-second-interval"])
        let other = try await repository.loadCodexTelemetryReview(
            localScopeID: "local", recordingID: fixture.otherRecordingID, intervalID: fixture.otherIntervalID)
        #expect(other.map(\.metadata.responseID) == ["response-other"])
        #expect(
            try await repository.loadCodexTelemetryReview(
                localScopeID: "other-scope", recordingID: fixture.recordingID, intervalID: fixture.firstIntervalID
            ).isEmpty)
        #expect(
            try await repository.loadCodexTelemetryReview(
                localScopeID: "local", recordingID: fixture.otherRecordingID, intervalID: fixture.firstIntervalID
            ).isEmpty)
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.store.url)
        #expect(
            try await reopened.loadCodexTelemetryReview(
                localScopeID: "local", recordingID: fixture.recordingID, intervalID: fixture.firstIntervalID) == first)
        #expect(
            try fixture.store.sql("SELECT id, hex(body), hex(receipt) FROM codex_telemetry ORDER BY rowid") == before)
        #expect(try fixture.store.sql("SELECT payload FROM recording_events ORDER BY sequence") == events)
        await reopened.close()
    }

    @Test
    func lateDeliveryInvalidatesReviewEvenWhenAcknowledgementFails() async throws {
        let fixture = try await RecordingTelemetryFixture.make()
        defer { fixture.store.remove() }
        let grant = try #require(
            try await fixture.repository.codexGrants().first {
                $0.binding.intervalID == fixture.firstIntervalID
            })
        let packet = try RecordingTelemetryFixture.packet(
            store: fixture.store, grant: grant, turn: "late-turn", response: "late-response", at: 8)
        let model = RecordingModel(
            repository: fixture.repository, localScopeID: "local",
            stamp: {
                fixture.store.event(.start, at: 100).stamp
            })
        model.load()
        await model.waitForIdle()
        let originalRevision = model.telemetryRevision
        await #expect(throws: RecordingInjectedFailure.self) {
            try await model.receiveLocalCodexTelemetry(packet, bindingID: grant.binding.bindingID) { _ in
                throw RecordingInjectedFailure.checkpoint
            }
        }
        #expect(model.telemetryRevision == originalRevision + 1)
        let rows = try await model.loadTelemetryReview(
            recordingID: fixture.recordingID, intervalID: fixture.firstIntervalID)
        #expect(rows.count == 6)
        #expect(rows.last?.metadata.responseID == "late-response")
        _ = try await model.receiveLocalCodexTelemetry(packet, bindingID: grant.binding.bindingID)
        #expect(
            try await model.loadTelemetryReview(recordingID: fixture.recordingID, intervalID: fixture.firstIntervalID)
                == rows)
        #expect(await model.shutdown())
    }

    @Test
    func loadingFailureEmptyAndSelectionRaceDoNotLeakPreviousRows() async throws {
        let fixture = try await RecordingTelemetryFixture.make()
        defer { fixture.store.remove() }
        let observations = try await fixture.repository.loadCodexTelemetryReview(
            localScopeID: "local", recordingID: fixture.recordingID, intervalID: fixture.firstIntervalID)
        let review = RecordingTelemetryReviewModel()
        let first = RecordingTelemetryReviewModel.Selection(
            recordingID: fixture.recordingID, intervalID: fixture.firstIntervalID, revision: 0)
        let second = RecordingTelemetryReviewModel.Selection(
            recordingID: fixture.otherRecordingID, intervalID: fixture.otherIntervalID, revision: 0)
        await review.load(first) { observations }
        #expect(review.state == .loaded(observations))
        var release: CheckedContinuation<[RecordingTelemetryObservation], Never>?
        let pending = Task {
            await review.load(first) {
                await withCheckedContinuation { release = $0 }
            }
        }
        // A continuation supplies a deterministic pending request without a timing sleep.
        while release == nil { await Task.yield() }
        #expect(review.state == .loading)
        await review.load(second) { throw RecordingInjectedFailure.checkpoint }
        #expect(review.state == .failed)
        release?.resume(returning: observations)
        await pending.value
        #expect(review.selection == second)
        #expect(review.state == .failed)
        await review.load(second) { [] }
        #expect(review.state == .loaded([]))
        await review.load(first) { observations }
        #expect(review.state == .loaded(observations))
        await fixture.repository.close()
    }

    @Test
    func sourceTimeTiesUseObservationIdentityNotDeliveryOrder() async throws {
        let fixture = try await RecordingTelemetryFixture.make()
        defer { fixture.store.remove() }
        let grant = try #require(
            try await fixture.repository.codexGrants().first {
                $0.binding.intervalID == fixture.firstIntervalID
            })
        for response in ["tie-z", "tie-a"] {
            let packet = try RecordingTelemetryFixture.packet(
                store: fixture.store, grant: grant, turn: "tie-turn", response: response, at: 10)
            _ = try await fixture.repository.receiveCodexTelemetry(
                packet, bindingID: grant.binding.bindingID, stamp: fixture.store.event(.start, at: 100).stamp)
        }
        let rows = try await fixture.repository.loadCodexTelemetryReview(
            localScopeID: "local", recordingID: fixture.recordingID, intervalID: fixture.firstIntervalID)
        let tied = rows.filter { $0.metadata.turnID == "tie-turn" }.map { $0.id.uuidString }
        #expect(tied.count == 2)
        #expect(tied == tied.sorted())
        await fixture.repository.close()
    }
}
