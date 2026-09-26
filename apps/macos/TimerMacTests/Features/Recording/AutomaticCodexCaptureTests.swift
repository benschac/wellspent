import Foundation
import Testing

@testable import TimerMac

@MainActor
struct AutomaticCodexCaptureTests {
    @Test(.timeLimit(.minutes(1)), arguments: [false, true])
    func delayedPriorIntervalACKKeepsConsentUntilImmediatePauseOrFinish(finishing: Bool) async throws {
        let fixture = try AutomaticCodexCaptureFixture()
        try await fixture.start()
        let model = fixture.makeModel()
        var releaseACK: CheckedContinuation<Void, Never>?
        var delayed: Task<CodexIntakeContract.Packet, Error>?
        do {
            try fixture.createSession("one")
            await fixture.load(model)
            try fixture.authorize(model)
            try await fixture.performEnabledAction(model, model.startRecording)
            try await fixture.waitForSources(1, model: model)
            let recording = try #require(model.current)
            let firstInterval = try #require(recording.activeIntervalID)
            let oldGrant = try #require(try await model.localCodexGrants().first)
            let oldTransport = try LocalCodexTransport(endpoint: oldGrant.endpoint)
            try fixture.append("one", turn: "old-interval-delayed-ack")
            await fixture.read(model)
            let oldPacket = try #require(
                try await oldTransport.pollTelemetry(bindingID: oldGrant.binding.bindingID, key: oldGrant.key).packet)
            try await fixture.performEnabledAction(model, model.pause)
            try await fixture.performEnabledAction(model, model.resume)
            try await fixture.waitForSources(1, model: model)
            let secondInterval = try #require(model.current?.activeIntervalID)
            let activeGrant = try #require(
                try await model.localCodexGrants().first { $0.binding.intervalID == secondInterval })
            #expect(activeGrant.binding.bindingID != oldGrant.binding.bindingID)
            let activeTransport = try LocalCodexTransport(endpoint: activeGrant.endpoint)

            let task = Task {
                try await model.receiveLocalCodexTelemetry(oldPacket, bindingID: oldGrant.binding.bindingID) { ack in
                    // Native has committed this old-interval observation, but HTTP ACK delivery still owns its gate.
                    await withCheckedContinuation { releaseACK = $0 }
                    try await oldTransport.acknowledgeTelemetry(ack)
                }
            }
            delayed = task
            for _ in 0..<100 where releaseACK == nil { try await Task.sleep(for: .milliseconds(10)) }
            try #require(releaseACK != nil)
            #expect(model.canAct == false)
            // The Pause case also exceeds the helper's 15-second lease using only the production native poller.
            // The Finish case independently exercises its boundary without repeating the long renewal wait.
            if !finishing { try await Task.sleep(for: .seconds(17)) }
            #expect(model.canAct == false)
            #expect(model.telemetry.automatic.isCollecting)
            try fixture.append("one", turn: "active-interval-during-delayed-ack")
            var activePacket: CodexIntakeContract.Packet?
            var queuedCount = 0
            for _ in 0..<16 {
                let polled = try await activeTransport.pollTelemetry(
                    bindingID: activeGrant.binding.bindingID, key: activeGrant.key)
                activePacket = polled.packet
                queuedCount = polled.pending
                if activePacket != nil && queuedCount == 4 { break }
                try await Task.sleep(for: .milliseconds(250))
            }
            try #require(
                activePacket != nil, "The existing source must keep reading while an earlier interval ACK is delayed")
            try #require(queuedCount == 4, "Both original and active interval observations must be durably queued")
            #expect(model.canAct == false)
            #expect(model.canPauseRecording)
            #expect(model.canFinishRecording)
            if finishing { model.finish() } else { model.pause() }
            #expect(model.acceptingEvents == false)
            #expect(model.telemetry.automatic.isCollecting == false)
            #expect(model.canAct == false)
            #expect(model.canPauseRecording == false)
            #expect(model.canFinishRecording == false)
            // Repeated boundary clicks while the earlier ACK owns the queue must not append duplicates.
            model.pause()
            model.finish()
            try fixture.append("one", turn: "after-immediate-boundary")
            await model.telemetry.automatic.waitForIdle()
            #expect(
                try await activeTransport.pollTelemetry(bindingID: activeGrant.binding.bindingID, key: activeGrant.key)
                    .pending == 4)
            releaseACK?.resume()
            releaseACK = nil
            _ = try await task.value
            delayed = nil
            #expect(try await model.localCodexGrants().count == 2)
            let saved = try #require(model.recordings.first)
            #expect(
                saved.events.filter { $0.intervalID == secondInterval && ($0.kind == .pause || $0.kind == .finish) }
                    .count == 1)
            if finishing {
                #expect(model.current == nil)
            } else {
                #expect(model.current?.status == .paused)
                try await fixture.performEnabledAction(model, model.finish)
            }
            await fixture.drain(model)
            let firstReview = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: firstInterval)
            let secondReview = try await model.loadTelemetryReview(
                recordingID: recording.id, intervalID: secondInterval)
            #expect(firstReview.count == 2)
            #expect(Set(firstReview.map(\.metadata.turnID)) == ["old-interval-delayed-ack"])
            #expect(secondReview.count == 2)
            #expect(Set(secondReview.map(\.metadata.turnID)) == ["active-interval-during-delayed-ack"])
            #expect(await model.shutdown())
            await fixture.cleanup()
        } catch {
            releaseACK?.resume()
            releaseACK = nil
            _ = try? await delayed?.value
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }

    @Test(.timeLimit(.minutes(1)))
    func activeNativeConsentRenewsShortHelperLeasesWithoutRepeatedUserAuthorization() async throws {
        let fixture = try AutomaticCodexCaptureFixture()
        try await fixture.start()
        let model = fixture.makeModel()
        do {
            try fixture.createSession("one")
            await fixture.load(model)
            try fixture.authorize(model)
            model.startRecording()
            await model.waitForIdle()
            try await fixture.waitForSources(1, model: model)
            let recording = try #require(model.current)
            let interval = try #require(recording.activeIntervalID)
            let original = try #require(try await model.localCodexGrants().first)
            // No fixture polling or user authorization occurs during this period. The production native
            // two-second poller must renew the 15-second process-bound lease while consent stays active.
            try await Task.sleep(for: .seconds(17))
            #expect(model.telemetry.automatic.isCollecting)
            #expect(try await model.localCodexGrants().count == 1)
            try fixture.append("one", turn: "after-original-lease-expired")
            try await Task.sleep(for: .seconds(3))
            model.finish()
            await fixture.drain(model)
            let review = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval)
            #expect(review.count == 2)
            #expect(Set(review.map(\.metadata.turnID)) == ["after-original-lease-expired"])
            #expect(try await model.localCodexGrants().first?.binding.bindingID == original.binding.bindingID)
            #expect(await model.shutdown())
            await fixture.cleanup()
        } catch {
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }

    @Test(.timeLimit(.minutes(2)))
    func simultaneousSessionsUseRealHTTPAndFreshResumeBindingsThenPersistReview() async throws {
        let fixture = try AutomaticCodexCaptureFixture()
        try await fixture.start()
        let model = fixture.makeModel()
        do {
            try fixture.createSession("one")
            try fixture.createSession("two")
            try fixture.append("one", turn: "historical-one")
            try fixture.append("two", turn: "historical-two")
            let outside = try fixture.createSession("outside", in: fixture.activation.root)
            try fixture.append("outside", turn: "outside-selection", to: outside)
            await fixture.load(model)
            try fixture.authorize(model, remember: true)
            await fixture.read(model)
            #expect(model.telemetry.automatic.isCollecting == false)
            #expect(try await model.localCodexGrants().isEmpty)

            model.startRecording()
            await model.waitForIdle()
            try await fixture.waitForSources(2, model: model)
            let recording = try #require(model.current)
            let firstInterval = try #require(recording.activeIntervalID)
            let firstGrants = try await model.localCodexGrants()
            #expect(firstGrants.count == 2)
            #expect(Set(firstGrants.map(\.binding.threadID)) == ["synthetic-thread-one", "synthetic-thread-two"])
            #expect(Set(firstGrants.map(\.binding.intervalID)) == [firstInterval])
            try fixture.append("one", turn: "first-one")
            try fixture.append("two", turn: "first-two")
            await fixture.read(model)

            let grant = try #require(firstGrants.first { $0.binding.threadID == "synthetic-thread-one" })
            let transport = try LocalCodexTransport(endpoint: grant.endpoint)
            let packet = try #require(
                try await transport.pollTelemetry(bindingID: grant.binding.bindingID, key: grant.key).packet)
            #expect(String(decoding: packet.body, as: UTF8.self).contains("SYNTHETIC_PRIVATE_CANARY") == false)
            await #expect(throws: CodexTelemetryContract.Failure.awaitingIntervalEnd) {
                try await model.receiveLocalCodexTelemetry(packet, bindingID: grant.binding.bindingID)
            }

            model.pause()
            #expect(model.telemetry.automatic.isCollecting == false)
            await model.waitForIdle()
            await model.telemetry.automatic.waitForIdle()
            try fixture.append("one", turn: "pause-gap-one")
            try fixture.append("two", turn: "pause-gap-two")
            await fixture.read(model)
            // Native commit succeeds; intentionally lose the ACK then demand identical retry bytes and receipt.
            let receipt = try await model.receiveLocalCodexTelemetry(packet, bindingID: grant.binding.bindingID)
            let retry = try #require(
                try await transport.pollTelemetry(bindingID: grant.binding.bindingID, key: grant.key).packet)
            #expect(retry == packet)
            #expect(try await model.receiveLocalCodexTelemetry(retry, bindingID: grant.binding.bindingID) == receipt)
            try await transport.acknowledgeTelemetry(receipt)
            try await transport.acknowledgeTelemetry(receipt)
            await fixture.drain(model)
            let firstReview = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: firstInterval)
            #expect(firstReview.count == 4)
            #expect(Set(firstReview.map(\.metadata.turnID)) == ["first-one", "first-two"])
            #expect(
                firstReview.filter { $0.metadata.kind == "turnConfiguration" }.allSatisfy {
                    $0.metadata.configuredModel == "gpt-6-sol" && $0.metadata.configuredEffort == "high"
                })
            #expect(
                firstReview.filter { $0.metadata.kind == "responseUsage" }.allSatisfy {
                    $0.metadata.usage?.inputTokens == 1200 && $0.metadata.usage?.totalTokens == 1290
                        && $0.metadata.usage?.cacheWriteInputTokens == nil
                })

            model.resume()
            await model.waitForIdle()
            try await fixture.waitForSources(2, model: model)
            let secondInterval = try #require(model.current?.activeIntervalID)
            #expect(secondInterval != firstInterval)
            let secondGrants = try await model.localCodexGrants().filter { $0.binding.intervalID == secondInterval }
            #expect(secondGrants.count == 2)
            #expect(Set(secondGrants.map(\.binding.bindingID)).isDisjoint(with: firstGrants.map(\.binding.bindingID)))
            // The third ordinary instance appears after Resume. Everything before enrollment is a baseline gap.
            try fixture.createSession("three")
            try fixture.append("three", turn: "new-instance-before-enrollment")
            try await fixture.waitForSources(3, model: model)
            try fixture.append("one", turn: "resumed-one")
            try fixture.append("two", turn: "resumed-two")
            try fixture.append("three", turn: "resumed-three")
            await fixture.read(model)
            model.finish()
            #expect(model.telemetry.automatic.isCollecting == false)
            await model.waitForIdle()
            try fixture.append("three", turn: "after-finish")
            await fixture.drain(model)
            let secondReview = try await model.loadTelemetryReview(
                recordingID: recording.id, intervalID: secondInterval)
            #expect(secondReview.count == 6)
            #expect(Set(secondReview.map(\.metadata.turnID)) == ["resumed-one", "resumed-two", "resumed-three"])
            #expect(try await model.loadTelemetryReview(recordingID: UUID(), intervalID: secondInterval).isEmpty)
            #expect(await model.shutdown())

            let reopened = fixture.makeModel()
            await fixture.load(reopened)
            #expect(reopened.telemetry.automatic.isCollecting == false)
            #expect(reopened.telemetry.automatic.includeCodexActivity == false)
            #expect(reopened.telemetry.automatic.hasDirectory)
            #expect(
                try await reopened.loadTelemetryReview(recordingID: recording.id, intervalID: firstInterval)
                    == firstReview)
            #expect(
                try await reopened.loadTelemetryReview(recordingID: recording.id, intervalID: secondInterval)
                    == secondReview)
            #expect(await reopened.shutdown())
            await fixture.cleanup()
        } catch {
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }

    @Test(.timeLimit(.minutes(2)))
    func supervisorRestartRequiresFreshNativeBindingsAndSkipsTheRestartGap() async throws {
        let fixture = try AutomaticCodexCaptureFixture()
        try await fixture.start()
        let model = fixture.makeModel()
        do {
            try fixture.createSession("one")
            await fixture.load(model)
            try fixture.authorize(model)
            model.startRecording()
            await model.waitForIdle()
            try await fixture.waitForSources(1, model: model)
            let recording = try #require(model.current)
            let interval = try #require(recording.activeIntervalID)
            let previous = try #require(try await model.localCodexGrants().first)
            try fixture.append("one", turn: "before-helper-restart")
            await fixture.read(model)
            try await fixture.activation.stopProcess()
            try fixture.append("one", turn: "helper-down-gap")
            try await fixture.start()
            // Restart has no source authority until the active native controller explicitly reauthorizes.
            try fixture.append("one", turn: "before-native-reauthorization")
            for _ in 0..<3 { await fixture.read(model) }
            try await fixture.waitForSources(1, model: model)
            let grants = try await model.localCodexGrants()
            #expect(grants.count >= 2)
            #expect(
                grants.contains {
                    $0.binding.bindingID != previous.binding.bindingID && $0.binding.intervalID == interval
                })
            try fixture.append("one", turn: "after-native-reauthorization")
            await fixture.read(model)
            model.finish()
            await fixture.drain(model)
            let review = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval)
            #expect(review.count == 4)
            #expect(Set(review.map(\.metadata.turnID)) == ["before-helper-restart", "after-native-reauthorization"])
            #expect(await model.shutdown())
            await fixture.cleanup()
        } catch {
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }

    @Test(.timeLimit(.minutes(2)))
    func sourceFailuresStayIsolatedAndDirectoryRevocationStopsNewReads() async throws {
        let fixture = try AutomaticCodexCaptureFixture()
        try await fixture.start()
        let model = fixture.makeModel()
        do {
            try fixture.createSession("healthy")
            let unreadable = try fixture.createSession("unreadable")
            let replaced = try fixture.createSession("replaced")
            try fixture.createSession("unsupported", version: "0.158.0")
            await fixture.load(model)
            try fixture.authorize(model)
            model.startRecording()
            await model.waitForIdle()
            try await fixture.waitForSources(3, model: model)
            let recording = try #require(model.current)
            let interval = try #require(recording.activeIntervalID)
            #expect(try await model.localCodexGrants().count == 3)
            try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: unreadable.path)
            try FileManager.default.removeItem(at: replaced)
            try fixture.createSession("replaced")
            try fixture.append("replaced", turn: "replacement-must-be-excluded")
            try fixture.append("unsupported", turn: "unsupported-must-be-excluded")
            try fixture.append("healthy", turn: "healthy-after-other-failures")
            await fixture.read(model)
            #expect(model.telemetry.automatic.isCollecting)
            model.telemetry.automatic.revokeDirectory()
            #expect(model.telemetry.automatic.isCollecting == false)
            await model.telemetry.automatic.waitForIdle()
            #expect(model.telemetry.automatic.hasDirectory == false)
            try fixture.append("healthy", turn: "after-revocation")
            await fixture.read(model)
            model.finish()
            await fixture.drain(model)
            let review = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval)
            #expect(review.count == 2)
            #expect(Set(review.map(\.metadata.turnID)) == ["healthy-after-other-failures"])
            #expect(await model.shutdown())
            await fixture.cleanup()
        } catch {
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }
}
