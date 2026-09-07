import Foundation
import Testing

@testable import TimerMac

struct TimerRealtimeContractTests {
    @Test
    func timerActionsMatchTheServerWireValues() {
        #expect(TimerAction.start.rawValue == "start")
        #expect(TimerAction.pause.rawValue == "pause")
        #expect(TimerAction.reset.rawValue == "reset")
    }

    @Test
    func timerStateEnvelopeDecodesTheServerContract() throws {
        let data = Data(
            #"{"event":"timer.state","data":{"elapsedMs":2500,"isRunning":true,"revision":4,"updatedAt":"2026-08-31T12:00:00.000Z"}}"#
                .utf8
        )

        let envelope = try JSONDecoder().decode(RealtimeStateEnvelope.self, from: data)

        #expect(envelope.event == "timer.state")
        #expect(envelope.data.elapsedMilliseconds == 2_500)
        #expect(envelope.data.isRunning)
        #expect(envelope.data.revision == 4)
        #expect(envelope.data.updatedAt == "2026-08-31T12:00:00.000Z")
    }

    @Test
    func timerCommandEnvelopeEncodesTheServerContract() throws {
        let data = try JSONEncoder().encode(
            RealtimeCommandEnvelope(action: .pause, commandId: "test-command")
        )
        let object = try #require(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        let commandData = try #require(object["data"] as? [String: Any])

        #expect(object["event"] as? String == "timer.command")
        #expect(commandData["action"] as? String == "pause")
        #expect(commandData["commandId"] as? String == "test-command")
    }
}
