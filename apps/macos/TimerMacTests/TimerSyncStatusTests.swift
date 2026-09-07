import Foundation
import Testing

@testable import TimerMac

struct TimerSyncStatusTests {
    @Test
    func commandsRemainPendingUntilTheirOwnAcknowledgement() throws {
        var tracker = TimerCommandTracker()
        tracker.enqueue([.start, .pause])
        let sent = tracker.beginSend()
        let first = try #require(sent)
        #expect(tracker.pendingCount == 2)
        let foreignAcknowledgement = tracker.acknowledge("another-client")
        #expect(foreignAcknowledgement == false)
        #expect(tracker.pendingCount == 2)
        let acknowledged = tracker.acknowledge(first.commandId)
        #expect(acknowledged)
        #expect(tracker.pendingCount == 1)
        let duplicate = tracker.acknowledge(first.commandId)
        #expect(duplicate == false)
    }

    @Test
    func disconnectNeverReplaysAnAttemptedCommand() throws {
        var tracker = TimerCommandTracker()
        tracker.enqueue([.reset, .pause])
        let sent = tracker.beginSend()
        let attempted = try #require(sent)
        tracker.disconnect()
        #expect(tracker.unconfirmed == [attempted.commandId])
        #expect(tracker.pendingCount == 1)
        let next = tracker.beginSend()
        let queued = try #require(next)
        #expect(queued.action == .pause)
        #expect(queued.commandId != attempted.commandId)
        let remaining = tracker.beginSend()
        #expect(remaining == nil)
    }

    @Test
    func lateAcknowledgementResolvesOnlyItsUncertainSend() throws {
        var tracker = TimerCommandTracker()
        tracker.enqueue([.reset, .start])
        let sentReset = tracker.beginSend()
        let sentStart = tracker.beginSend()
        let reset = try #require(sentReset)
        let start = try #require(sentStart)
        tracker.markUnconfirmed(reset.commandId)
        let acknowledged = tracker.acknowledge(reset.commandId)
        #expect(acknowledged)
        #expect(tracker.unconfirmed.isEmpty)
        #expect(tracker.awaiting == [start.commandId])
    }

    @Test
    func acknowledgementDecodesThePersistedSnapshot() throws {
        let data = Data(
            #"{"event":"timer.command.ack","data":{"commandId":"my-command","state":{"elapsedMs":125,"isRunning":true,"revision":14,"updatedAt":"2026-09-06T12:00:00.123Z"}}}"#
                .utf8)
        let message = try JSONDecoder().decode(RealtimeServerMessage.self, from: data)
        guard case .acknowledgement(let id, let state) = message else {
            Issue.record("Expected command acknowledgement")
            return
        }
        #expect(id == "my-command")
        #expect(state.revision == 14)
        #expect(state.elapsedMilliseconds == 125)
    }

    @Test(arguments: [
        #"{"event":"timer.state","data":{"elapsedMs":-1,"isRunning":true,"revision":14,"updatedAt":"2026-09-06T12:00:00.000Z"}}"#,
        #"{"event":"timer.state","data":{"elapsedMs":0,"isRunning":true,"revision":-1,"updatedAt":"2026-09-06T12:00:00.000Z"}}"#,
        #"{"event":"timer.state","data":{"elapsedMs":0,"isRunning":true,"revision":14,"updatedAt":"invalid"}}"#,
    ])
    func invalidSnapshotsAreRejected(_ json: String) {
        #expect(throws: (any Error).self) {
            try JSONDecoder().decode(RealtimeServerMessage.self, from: Data(json.utf8))
        }
    }

    @Test
    func diagnosticsNeverExposeURLCredentials() {
        #expect(
            TimerProjection.diagnosticEndpoint(from: "https://user:secret@example.com/base?token=secret#secret")
                == "wss://example.com/api/ws")
        #expect(TimerProjection.diagnosticEndpoint(from: "http://localhost:3001") == "ws://localhost:3001/api/ws")
        #expect(TimerProjection.diagnosticEndpoint(from: "file:///secret") == "Invalid API URL")
    }

    @Test
    func onlyValidSnapshotsCompleteTheHandshake() async {
        let client = TimerRealtimeClient()
        #expect(await client.handle(message: .string(#"{"event":"pong","data":{}}"#)) == false)
        #expect(
            await client.handle(
                message: .string(
                    #"{"event":"timer.command.ack","data":{"commandId":"another-client","state":{"elapsedMs":0,"isRunning":false,"revision":14,"updatedAt":"2026-09-06T12:00:00.000Z"}}}"#
                )) == false)
        #expect(await client.handle(message: .string("invalid")) == false)
        #expect(
            await client.handle(
                message: .string(
                    #"{"event":"timer.state","data":{"elapsedMs":0,"isRunning":false,"revision":14,"updatedAt":"2026-09-06T12:00:00.000Z"}}"#
                )))
        await client.shutdown()
    }

    @Test
    func connectionLabelsSeparateConnectionFromConfirmation() {
        #expect(ConnectionState.connected.label == "Connected")
        #expect(ConnectionState.connecting.label == "Connecting")
        #expect(ConnectionState.reconnecting.label == "Offline")
        #expect(ConnectionState.syncError.label == "Sync error")
    }
}
