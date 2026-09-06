import AppKit
import LiquidUI
import SwiftUI
import XCTest

@testable import TimerMac

final class TimerFrostedViewTests: XCTestCase {
    @MainActor func testFrostMaskFollowsEveryAttachedEdge() throws {
        for edge in TimerSidebarEdge.allCases {
            let size = TimerSidebarLayout.size(for: edge)
            let view = TimerFrostedView(frame: CGRect(origin: .zero, size: size))
            view.updateMask(
                size: size, path: TimerSidebarShape(edge: edge).path(in: CGRect(origin: .zero, size: size)).cgPath)
            XCTAssertEqual(view.blendingMode, .behindWindow)
            let mask = try XCTUnwrap(view.maskImage?.cgImage(forProposedRect: nil, context: nil, hints: nil))
            let pixels = NSBitmapImageRep(cgImage: mask)
            func alpha(at point: CGPoint) -> CGFloat {
                pixels.colorAt(
                    x: Int(point.x / size.width * CGFloat(pixels.pixelsWide)),
                    y: Int(point.y / size.height * CGFloat(pixels.pixelsHigh)))?.alphaComponent ?? 0
            }
            XCTAssertGreaterThan(alpha(at: CGPoint(x: size.width / 2, y: size.height / 2)), 0.95)
            let outside: CGPoint
            switch edge {
            case .left: outside = CGPoint(x: size.width - 2, y: 2)
            case .right, .bottom: outside = CGPoint(x: 2, y: 2)
            case .top: outside = CGPoint(x: 2, y: size.height - 2)
            }
            XCTAssertLessThan(alpha(at: outside), 0.05, "The desktop blur must not fill a transparent shoulder")
        }
    }

    @MainActor func testUnchangedGeometryReusesTheMask() {
        let view = TimerFrostedView()
        let size = CGSize(width: 244, height: 80)
        view.updateMask(
            size: size, path: TimerSidebarShape(edge: nil).path(in: CGRect(origin: .zero, size: size)).cgPath)
        let mask = view.maskImage
        view.updateMask(
            size: size, path: TimerSidebarShape(edge: nil).path(in: CGRect(origin: .zero, size: size)).cgPath)
        XCTAssertTrue(view.maskImage === mask)
    }
}
