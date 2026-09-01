import XCTest

@testable import TimerMac

final class TimerProjectionTests: XCTestCase {
    func testRunningStateProjectsElapsedTimeFromServerTimestamp() {
        let state = RealtimeTimerState(
            elapsedMilliseconds: 4_000,
            isRunning: true,
            revision: 3,
            updatedAt: "2026-08-31T12:00:00.000Z"
        )
        let now = try? Date("2026-08-31T12:00:02.500Z", strategy: .iso8601)

        XCTAssertEqual(
            TimerProjection.elapsedMilliseconds(for: state, now: now ?? .distantPast),
            6_500,
            accuracy: 1
        )
    }

    func testPausedStateDoesNotAccumulateWallClockTime() {
        let state = RealtimeTimerState(
            elapsedMilliseconds: 4_000,
            isRunning: false,
            revision: 3,
            updatedAt: "2026-08-31T12:00:00.000Z"
        )

        XCTAssertEqual(
            TimerProjection.elapsedMilliseconds(for: state, now: .distantFuture),
            4_000
        )
    }

    func testHTTPAPIURLBecomesWebSocketEndpoint() {
        XCTAssertEqual(
            TimerProjection.webSocketURL(from: "https://timer.example.com/base")?.absoluteString,
            "wss://timer.example.com/api/ws"
        )
    }

    func testUnsupportedURLSchemeIsRejected() {
        XCTAssertNil(TimerProjection.webSocketURL(from: "file:///tmp/timer"))
    }
}
