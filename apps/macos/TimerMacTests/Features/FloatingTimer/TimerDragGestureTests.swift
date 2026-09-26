import XCTest

@testable import TimerMac

final class TimerDragGestureTests: XCTestCase {
    func testClickWithSmallHandMovementRemainsAClick() {
        var gesture = TimerDragGesture()
        gesture.begin(at: CGPoint(x: 100, y: 100))
        XCTAssertFalse(gesture.shouldBeginDragging(at: CGPoint(x: 102, y: 101)))
        XCTAssertTrue(gesture.end())
    }

    func testDraggingDoesNotAlsoClick() {
        var gesture = TimerDragGesture()
        gesture.begin(at: CGPoint(x: 100, y: 100))
        XCTAssertTrue(gesture.shouldBeginDragging(at: CGPoint(x: 110, y: 100)))
        XCTAssertFalse(gesture.end())
    }

    func testReturningToOriginalLocationDoesNotTurnDragIntoClick() {
        var gesture = TimerDragGesture()
        gesture.begin(at: .zero)
        XCTAssertTrue(gesture.shouldBeginDragging(at: CGPoint(x: 10, y: 0)))
        XCTAssertFalse(gesture.shouldBeginDragging(at: .zero))
        XCTAssertFalse(gesture.end())
    }

    func testDuplicateMouseUpDoesNotClick() {
        var gesture = TimerDragGesture()
        gesture.begin(at: .zero)
        XCTAssertTrue(gesture.end())
        XCTAssertFalse(gesture.end())
    }

    func testNextClickWorksAfterDrag() {
        var gesture = TimerDragGesture()
        gesture.begin(at: .zero)
        XCTAssertTrue(gesture.shouldBeginDragging(at: CGPoint(x: 10, y: 0)))
        XCTAssertFalse(gesture.end())
        gesture.begin(at: CGPoint(x: 10, y: 0))
        XCTAssertTrue(gesture.end())
    }
}
