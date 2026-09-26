import Foundation
import Testing

@testable import TimerMac

@MainActor
struct RecordingTelemetryActivationTests {
    @Test(.timeLimit(.minutes(1)))
    func stalePairingBackoffDoesNotDelayHealthyTelemetryDelivery() async throws {
        let fixture = try RecordingTelemetryActivationFixture()
        let model = fixture.makeModel()
        do {
            try await fixture.start()
            try await fixture.startRecording(model)
            let recording = try #require(model.current)
            let interval = try #require(recording.activeIntervalID)
            // Native remembers this binding, but the disposable HTTP helper does not.
            _ = try await model.pairLocalCodex(
                senderID: "stale_sender", threadID: "stale_thread",
                endpoint: "http://127.0.0.1:\(fixture.port)")
            try await fixture.authorize(model)
            try fixture.append()
            await model.telemetry.readIfAuthorized()
            model.finish()
            await model.waitForIdle()
            await model.telemetry.waitForIdle()
            #expect(await model.codex.pollOnce() == false)
            let first = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval)
            #expect(first.count == 1)
            // The failed binding is cooling down; the healthy binding is immediately eligible.
            #expect(await model.codex.pollOnce())
            let second = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval)
            #expect(second.count == 2)
            #expect(Set(second.map(\.metadata.kind)) == ["turnConfiguration", "responseUsage"])
            #expect(await model.shutdown())
            await fixture.cleanup()
        } catch {
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }

    @Test(.timeLimit(.minutes(1)))
    func productionHTTPPathKeepsQueuedBytesThroughPauseLostACKResumeAndReopen() async throws {
        let fixture = try RecordingTelemetryActivationFixture()
        let model = fixture.makeModel()
        do {
            try await fixture.start()
            try await fixture.startRecording(model)
            let recording = try #require(model.current)
            let interval = try #require(recording.activeIntervalID)
            #expect(model.telemetry.isCollecting == false)
            try await fixture.authorize(model)
            let grant = try #require(try await model.localCodexGrants().first)
            let transport = try LocalCodexTransport(endpoint: grant.endpoint)
            #expect(try await transport.telemetrySupported(bindingID: grant.binding.bindingID, key: grant.key))

            // A second source is present but never selected or read by the supervisor.
            let other = fixture.root.appendingPathComponent("unselected-synthetic.jsonl")
            try Data().write(to: other)
            try fixture.append(turn: "unselected", to: other)
            try fixture.append()
            await model.telemetry.readIfAuthorized()
            let queued = try #require(
                try await transport.pollTelemetry(bindingID: grant.binding.bindingID, key: grant.key).packet)
            #expect(String(decoding: queued.body, as: UTF8.self).contains("SYNTHETIC_PRIVATE_CANARY") == false)
            await #expect(throws: CodexTelemetryContract.Failure.awaitingIntervalEnd) {
                try await model.receiveLocalCodexTelemetry(queued, bindingID: grant.binding.bindingID)
            }

            // The ordinary native poll previews every queued observation while still recording.
            #expect(try await transport.telemetryPreviewSupported(bindingID: grant.binding.bindingID, key: grant.key))
            #expect(await model.codex.pollOnce())
            #expect(model.current?.status == .recording)
            #expect(model.liveTelemetryObservations.count == 2)
            let previews = Array(model.liveTelemetryObservations.values)
            #expect(Set(previews.map(\.metadata.kind)) == ["turnConfiguration", "responseUsage"])
            #expect(
                previews.first { $0.id == (try? CodexTelemetryContract.parse(queued.body).observationID) }?.exactBody
                    == queued.body)
            #expect(try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval).isEmpty)
            #expect(await model.codex.pollOnce())
            #expect(model.liveTelemetryObservations.count == 2)
            let damaged = CodexIntakeContract.Packet(body: queued.body, mac: Data(repeating: 0, count: 32))
            #expect(throws: CodexTelemetryContract.Failure.untrustedSender) {
                try model.previewLocalCodexTelemetry(damaged, grant: grant)
            }
            var expired = grant
            expired = .init(
                binding: grant.binding, key: grant.key, issuedAt: grant.issuedAt,
                acceptUntil: .distantPast, endpoint: grant.endpoint)
            #expect(model.canPreviewTelemetry(expired) == false)

            model.pause()
            #expect(model.canPreviewTelemetry(grant) == false)
            #expect(throws: CodexTelemetryContract.Failure.invalidAssociation) {
                try model.previewLocalCodexTelemetry(queued, grant: grant)
            }
            #expect(model.telemetry.isCollecting == false)
            await model.waitForIdle()
            await model.telemetry.waitForIdle()
            try fixture.append(turn: "after-pause")
            await model.telemetry.readIfAuthorized()
            #expect(try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval).isEmpty)

            // Commit without delivering its ACK simulates a lost connection after SQLite commit.
            let ack = try await model.receiveLocalCodexTelemetry(queued, bindingID: grant.binding.bindingID)
            let retry = try #require(
                try await transport.pollTelemetry(bindingID: grant.binding.bindingID, key: grant.key).packet)
            #expect(retry == queued)
            let retryACK = try await model.receiveLocalCodexTelemetry(retry, bindingID: grant.binding.bindingID)
            #expect(retryACK == ack)
            try await transport.acknowledgeTelemetry(retryACK)
            try await transport.acknowledgeTelemetry(ack)
            // The ordinary intake handles the other queued observation over HTTP after closure.
            #expect(await model.codex.pollOnce())
            let firstReview = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval)
            #expect(firstReview.count == 2)
            #expect(model.liveTelemetryObservations.isEmpty)
            let items = RecordingTimelineItem.merged(
                entries: [], saved: firstReview, pending: previews,
                recordingID: recording.id, intervalID: interval)
            #expect(items.count == 2)
            #expect(
                items.allSatisfy {
                    if case .codex(let row) = $0 { return !row.isPending }
                    return false
                })
            #expect(items.map(\.timelineTime) == items.map(\.timelineTime).sorted(by: >))
            #expect(
                RecordingTimelineItem.merged(
                    entries: [], saved: firstReview, pending: previews,
                    recordingID: UUID(), intervalID: interval
                ).isEmpty)
            #expect(Set(firstReview.map(\.metadata.turnID)) == ["synthetic-turn"])
            #expect(
                firstReview.first { $0.metadata.kind == "turnConfiguration" }?.metadata.configuredModel == "gpt-6-sol")
            #expect(firstReview.first { $0.metadata.kind == "turnConfiguration" }?.metadata.configuredEffort == "high")
            #expect(firstReview.first { $0.metadata.kind == "responseUsage" }?.metadata.usage?.inputTokens == 1200)
            #expect(
                firstReview.first { $0.metadata.kind == "responseUsage" }?.metadata.usage?.cacheWriteInputTokens == nil)
            #expect(try await transport.pollTelemetry(bindingID: grant.binding.bindingID, key: grant.key).packet == nil)

            model.resume()
            await model.waitForIdle()
            let nextInterval = try #require(model.current?.activeIntervalID)
            #expect(nextInterval != interval)
            #expect(model.telemetry.isCollecting == false)
            try fixture.append(turn: "before-new-authorization")
            await model.telemetry.readIfAuthorized()
            try fixture.prepareSelection(model)
            try await fixture.authorize(model)
            let nextGrant = try #require(
                try await model.localCodexGrants().first { $0.binding.intervalID == nextInterval })
            #expect(nextGrant.binding.bindingID != grant.binding.bindingID)
            try fixture.append(turn: "resumed-turn")
            await model.telemetry.readIfAuthorized()
            model.finish()
            #expect(model.telemetry.isCollecting == false)
            await model.waitForIdle()
            await model.telemetry.waitForIdle()
            try fixture.append(turn: "after-finish")
            for _ in 0..<2 { #expect(await model.codex.pollOnce()) }
            let secondReview = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: nextInterval)
            #expect(secondReview.count == 2)
            #expect(Set(secondReview.map(\.metadata.turnID)) == ["resumed-turn"])
            #expect(try await model.loadTelemetryReview(recordingID: UUID(), intervalID: interval).isEmpty)
            #expect(await model.shutdown())

            let reopened = fixture.makeModel()
            reopened.load()
            await reopened.waitForIdle()
            #expect(reopened.telemetry.isCollecting == false)
            #expect(reopened.liveTelemetryObservations.isEmpty)
            #expect(reopened.telemetry.filePath.isEmpty)
            #expect(
                try await reopened.loadTelemetryReview(recordingID: recording.id, intervalID: interval) == firstReview)
            #expect(
                try await reopened.loadTelemetryReview(recordingID: recording.id, intervalID: nextInterval)
                    == secondReview)
            #expect(await reopened.shutdown())
            await fixture.cleanup()
        } catch {
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }

    @Test(.timeLimit(.minutes(1)))
    func supervisorRestartDrainsQueuedEvidenceButRequiresExplicitAuthorizationAndReportsSourceFailure() async throws {
        let fixture = try RecordingTelemetryActivationFixture()
        let model = fixture.makeModel()
        do {
            try await fixture.start()
            try await fixture.startRecording(model)
            try await fixture.authorize(model)
            let recording = try #require(model.current)
            let interval = try #require(recording.activeIntervalID)
            try fixture.append()
            await model.telemetry.readIfAuthorized()
            try await fixture.stopProcess()
            try await fixture.start()
            try fixture.append(turn: "after-restart")
            await model.telemetry.readIfAuthorized()
            #expect(model.telemetry.isCollecting == false)
            #expect(model.telemetry.status.contains("restarted"))
            model.pause()
            await model.waitForIdle()
            await model.telemetry.waitForIdle()
            for _ in 0..<2 { #expect(await model.codex.pollOnce()) }
            let review = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval)
            #expect(review.count == 2)
            #expect(Set(review.map(\.metadata.turnID)) == ["synthetic-turn"])

            model.resume()
            await model.waitForIdle()
            #expect(model.telemetry.isCollecting == false)
            try fixture.prepareSelection(model)
            try await fixture.authorize(model)
            try FileManager.default.removeItem(at: fixture.source)
            await model.telemetry.readIfAuthorized()
            #expect(model.telemetry.isCollecting == false)
            #expect(model.telemetry.status.contains("source_unavailable"))
            model.finish()
            await model.waitForIdle()
            #expect(await model.shutdown())
            await fixture.cleanup()
        } catch {
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }
}
