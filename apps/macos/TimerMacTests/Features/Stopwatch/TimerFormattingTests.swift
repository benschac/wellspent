import XCTest

@testable import TimerMac

final class TimerFormattingTests: XCTestCase {
    func testClockFormattingPadsMinutesAndSeconds() {
        XCTAssertEqual(TimerFormatting.clock(milliseconds: 65_999), "01:05")
    }

    func testClockFormattingClampsNegativeValues() {
        XCTAssertEqual(TimerFormatting.clock(milliseconds: -1), "00:00")
    }
}
