import Foundation
import Testing
import os

@testable import TimerMac

@MainActor
struct TimerModelTests {
    private final class TestClock: Sendable {
        private let uptime = OSAllocatedUnfairLock(initialState: 0.0)

        var clock: TimerClock {
            TimerClock(
                now: { .distantPast },
                systemUptime: { self.uptime.withLock { $0 } }
            )
        }

        func advance(seconds: Double) {
            uptime.withLock { $0 += seconds }
        }
    }

    private func makeModel(clock: TestClock) throws -> TimerModel {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        // Keep tests offline and verify that the old saved duration is ignored.
        defaults.register(defaults: ["apiBaseURL": "file:///timer-test", "durationMinutes": 25])
        return TimerModel(settingsStore: SettingsStore(defaults: defaults), clock: clock.clock)
    }

    @Test
    func countsUpAndResumesPastTheFormerDurationLimit() throws {
        let clock = TestClock()
        let model = try makeModel(clock: clock)
        #expect(model.menuBarTitle == "00:00")
        #expect(model.accessibilityTimerLabel == "0 minutes, 0 seconds elapsed")

        model.startOrResume()
        clock.advance(seconds: 1_561.5)
        model.pause()
        #expect(model.menuBarTitle == "26:01")
        #expect(model.displayElapsedMilliseconds == 1_561_500)
        #expect(model.minuteProgress == 0.025)

        clock.advance(seconds: 600)
        model.pause()
        #expect(model.displayElapsedMilliseconds == 1_561_500)
        model.startOrResume()
        #expect(model.displayElapsedMilliseconds == 1_561_500)
        clock.advance(seconds: 5_638.5)
        model.pause()
        #expect(model.menuBarTitle == "120:00")
        #expect(model.accessibilityTimerLabel == "120 minutes, 0 seconds elapsed")
        #expect(model.minuteProgress == 0)
    }

    @Test
    func resetWhileRunningCountsUpFromZeroWithoutPausing() throws {
        let clock = TestClock()
        let model = try makeModel(clock: clock)
        model.startOrResume()
        clock.advance(seconds: 90)
        model.reset()
        #expect(model.isRunning)
        #expect(model.menuBarTitle == "00:00")

        clock.advance(seconds: 2)
        model.pause()
        #expect(model.displayElapsedMilliseconds == 2_000)
        #expect(model.menuBarTitle == "00:02")
    }

    @Test
    func resetWhilePausedStaysPausedUntilStarted() throws {
        let clock = TestClock()
        let model = try makeModel(clock: clock)
        model.startOrResume()
        clock.advance(seconds: 90)
        model.pause()
        model.reset()
        #expect(model.isRunning == false)
        #expect(model.menuBarTitle == "00:00")

        clock.advance(seconds: 60)
        model.startOrResume()
        clock.advance(seconds: 3)
        model.pause()
        #expect(model.displayElapsedMilliseconds == 3_000)
    }

    @Test
    func repeatedStartDoesNotLoseTimeBetweenDisplayUpdates() throws {
        let clock = TestClock()
        let model = try makeModel(clock: clock)
        model.startOrResume()
        clock.advance(seconds: 0.125)
        model.startOrResume()
        clock.advance(seconds: 0.125)
        model.pause()
        #expect(model.displayElapsedMilliseconds == 250)
    }

    @Test
    func ringAdvancesBetweenDisplayUpdatesAndWrapsEachMinute() throws {
        let clock = TestClock()
        let model = try makeModel(clock: clock)
        model.startOrResume()
        clock.advance(seconds: 30)
        #expect(model.minuteProgress == 0.5)
        // No display ticker has run: ring rendering does not publish an update.
        #expect(model.displayElapsedMilliseconds == 0)

        clock.advance(seconds: 1.0 / 60)
        #expect(abs(model.minuteProgress - (30 + 1.0 / 60) / 60) < 0.000_001)
        #expect(model.displayElapsedMilliseconds == 0)

        clock.advance(seconds: 30 - 1.0 / 60)
        #expect(abs(model.minuteProgress) < 0.000_001)
        clock.advance(seconds: 15)
        #expect(abs(model.minuteProgress - 0.25) < 0.000_001)
    }

    @Test
    func ringFreezesOnPauseAndRebasesOnResumeAndReset() throws {
        let clock = TestClock()
        let model = try makeModel(clock: clock)
        model.startOrResume()
        clock.advance(seconds: 30)
        model.pause()
        clock.advance(seconds: 10)
        #expect(model.minuteProgress == 0.5)

        model.startOrResume()
        #expect(model.minuteProgress == 0.5)
        clock.advance(seconds: 15)
        #expect(model.minuteProgress == 0.75)

        model.reset()
        #expect(model.minuteProgress == 0)
        clock.advance(seconds: 15)
        #expect(model.minuteProgress == 0.25)
        model.pause()
        model.reset()
        clock.advance(seconds: 30)
        #expect(model.minuteProgress == 0)
    }
}
