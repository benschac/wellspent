import LiquidUI
import XCTest

@testable import TimerMac

final class TimerSidebarLayoutTests: XCTestCase {
    private let screen = CGRect(x: 0, y: 50, width: 1440, height: 850)

    func testDefaultPlacementHugsUsableRightEdge() {
        let frame = TimerSidebarLayout.frame(for: TimerSidebarPlacement(), in: screen)
        XCTAssertEqual(frame.maxX, screen.maxX)
        let geometry = TimerWidgetGeometry(horizontal: 0, detachment: 0, handleEdge: .right)
        let canvasBottom = min(frame.minY, frame.maxY - geometry.handleFrame.maxY)
        XCTAssertEqual((canvasBottom + frame.maxY) / 2, screen.midY, accuracy: 0.001)
    }

    func testDropOutsideMagneticZoneStaysAtDroppedCenter() {
        let drop = CGRect(x: 500, y: 300, width: 80, height: 244)
        let placement = settle(drop)
        let frame = TimerSidebarLayout.frame(for: placement, in: screen)
        XCTAssertNil(placement.edge)
        XCTAssertEqual(frame.midX, drop.midX, accuracy: 0.001)
        XCTAssertEqual(frame.midY, drop.midY, accuracy: 0.001)
    }

    func testSnapZoneHasABoundedThreshold() {
        let inside = CGRect(x: 1440 - 80 - 78, y: 300, width: 80, height: 244)
        let outside = inside.offsetBy(dx: -1, dy: 0)
        XCTAssertEqual(settle(inside).edge, .right)
        XCTAssertNil(settle(outside).edge)
    }

    func testAllFourEdgesSnapAndRemainOnScreen() {
        let drops: [(TimerSidebarEdge, CGRect)] = [
            (.left, CGRect(x: 15, y: 300, width: 80, height: 244)),
            (.right, CGRect(x: 1345, y: 300, width: 80, height: 244)),
            (.top, CGRect(x: 500, y: 900 - 244 - 15, width: 80, height: 244)),
            (.bottom, CGRect(x: 500, y: 65, width: 80, height: 244)),
        ]
        for (edge, drop) in drops {
            let placement = settle(drop)
            XCTAssertEqual(placement.edge, edge)
            let frame = TimerSidebarLayout.frame(for: placement, in: screen)
            XCTAssertTrue(screen.contains(frame))
            XCTAssertEqual(frame.width > frame.height, edge.isHorizontal)
        }
    }

    func testMagnetCanBeDisabled() {
        let placement = TimerSidebarLayout.placement(
            afterDropping: CGRect(x: 1350, y: 300, width: 80, height: 244),
            in: screen, displayID: nil, magneticEdges: false, preferredEdge: .right
        )
        XCTAssertNil(placement.edge)
    }

    func testCornerTieKeepsPreviousEdge() {
        let drop = CGRect(x: 0, y: 900 - 244, width: 80, height: 244)
        XCTAssertEqual(settle(drop, preferredEdge: .top).edge, .top)
        XCTAssertEqual(settle(drop, preferredEdge: .left).edge, .left)
    }

    func testPlacementRestoresOnNegativeCoordinateAndResizedDisplays() throws {
        let placement = TimerSidebarPlacement(displayID: "external", x: 0.8, y: 0.7, edge: nil)
        let restored = try JSONDecoder().decode(
            TimerSidebarPlacement.self, from: JSONEncoder().encode(placement)
        )
        XCTAssertEqual(restored, placement)
        for screen in [
            CGRect(x: -1920, y: 120, width: 1920, height: 1055),
            CGRect(x: 0, y: 50, width: 1024, height: 650),
        ] {
            let frame = TimerSidebarLayout.frame(for: restored, in: screen)
            XCTAssertTrue(screen.contains(frame))
            let grip = TimerWidgetGeometry(horizontal: 1).handleFrame
            let canvas = frame.union(
                CGRect(
                    x: frame.minX + grip.minX, y: frame.maxY - grip.maxY,
                    width: grip.width, height: grip.height))
            XCTAssertTrue(screen.contains(canvas))
            XCTAssertEqual((canvas.minX - screen.minX) / (screen.width - canvas.width), 0.8, accuracy: 0.001)
        }
    }

    func testOffscreenDropIsClampedBackToUsableArea() {
        let placement = settle(CGRect(x: 1430, y: 875, width: 244, height: 80))
        XCTAssertTrue(screen.contains(TimerSidebarLayout.frame(for: placement, in: screen)))
    }

    func testInvalidPersistedCoordinatesAreRejected() {
        XCTAssertFalse(TimerSidebarPlacement(x: .nan).isValid)
        XCTAssertFalse(TimerSidebarPlacement(y: .infinity).isValid)
        XCTAssertFalse(TimerSidebarPlacement(x: -0.1).isValid)
        XCTAssertFalse(TimerSidebarPlacement(y: 1.1).isValid)
    }

    func testHitShapeFollowsEveryOrientation() {
        for edge in TimerSidebarEdge.allCases {
            let bounds = CGRect(origin: .zero, size: TimerSidebarLayout.size(for: edge))
            let path = TimerSidebarShape(edge: edge).path(in: bounds)
            XCTAssertTrue(path.contains(CGPoint(x: bounds.midX, y: bounds.midY)))
            let outsideShoulder: CGPoint
            switch edge {
            case .left: outsideShoulder = CGPoint(x: bounds.maxX - 2, y: 2)
            case .right, .bottom: outsideShoulder = CGPoint(x: 2, y: 2)
            case .top: outsideShoulder = CGPoint(x: 2, y: bounds.maxY - 2)
            }
            XCTAssertFalse(path.contains(outsideShoulder))
        }
    }

    private func settle(_ drop: CGRect, preferredEdge: TimerSidebarEdge? = .right) -> TimerSidebarPlacement {
        TimerSidebarLayout.placement(
            afterDropping: drop, in: screen, displayID: "primary",
            magneticEdges: true, preferredEdge: preferredEdge
        )
    }
}
