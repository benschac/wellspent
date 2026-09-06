import LiquidUI
import XCTest

@testable import TimerMac

final class TimerDetachmentHapticTests: XCTestCase {
    func testTickCoincidesWithSeparationAndDoesNotRepeatDuringTheDrag() {
        var feedback = TimerDetachmentHaptic()
        feedback.begin(attached: true, gap: 0)
        let threshold = TimerLiquidShape.separationDistance
        XCTAssertFalse(feedback.update(gap: threshold - 0.1))
        XCTAssertTrue(feedback.update(gap: threshold))
        for gap in [threshold + 1, threshold - 1, threshold, 0, threshold + 100] {
            XCTAssertFalse(feedback.update(gap: gap))
        }
    }

    func testPickingUpAnAlreadyDetachedWidgetIsSilent() {
        var feedback = TimerDetachmentHaptic()
        feedback.begin(attached: false, gap: 0)
        XCTAssertFalse(feedback.update(gap: 200))
        // Picking up a settling widget after the neck has already split must
        // not replay the detachment feedback either.
        feedback.begin(attached: true, gap: TimerLiquidShape.separationDistance + 1)
        XCTAssertFalse(feedback.update(gap: 200))
    }

    func testANewAttachedPickupCanTickAgain() {
        var feedback = TimerDetachmentHaptic()
        feedback.begin(attached: true, gap: 0)
        XCTAssertTrue(feedback.update(gap: 200))
        feedback.begin(attached: true, gap: 0)
        XCTAssertFalse(feedback.update(gap: 3))
        XCTAssertTrue(feedback.update(gap: 200))
    }
}
