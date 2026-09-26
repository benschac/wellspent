import Testing

@testable import TimerMac

struct TimerAccessibilityTests {
    @Test
    func elapsedTimeUsesSingularUnits() {
        #expect(
            TimerFormatting.accessibilityLabel(milliseconds: 61_000)
                == "1 minute, 1 second elapsed"
        )
    }

    @Test
    func elapsedTimeUsesPluralUnits() {
        #expect(
            TimerFormatting.accessibilityLabel(milliseconds: 122_000)
                == "2 minutes, 2 seconds elapsed"
        )
    }

    @Test
    func longSessionStillReportsElapsedTime() {
        #expect(
            TimerFormatting.accessibilityLabel(
                milliseconds: 7_200_000
            ) == "120 minutes, 0 seconds elapsed"
        )
    }
}
