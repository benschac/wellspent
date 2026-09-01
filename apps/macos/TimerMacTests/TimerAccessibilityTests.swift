import Testing

@testable import TimerMac

struct TimerAccessibilityTests {
    @Test
    func remainingTimeUsesSingularUnits() {
        #expect(
            TimerFormatting.accessibilityLabel(milliseconds: 61_000)
                == "1 minute, 1 second remaining"
        )
    }

    @Test
    func remainingTimeUsesPluralUnits() {
        #expect(
            TimerFormatting.accessibilityLabel(milliseconds: 122_000)
                == "2 minutes, 2 seconds remaining"
        )
    }

    @Test
    func completedTimerHasCompletionLabel() {
        #expect(
            TimerFormatting.accessibilityLabel(
                milliseconds: 0,
                isComplete: true
            ) == "Time complete"
        )
    }
}
