import AppKit
import LiquidUI
import SwiftUI
import XCTest

@testable import TimerMac

final class TimerLiquidShapeTests: XCTestCase {
    private func fixture(_ progress: CGFloat, edge: TimerSidebarEdge = .right) -> TimerLiquidShape {
        let geometry = TimerSidebarGeometry(
            horizontal: edge.isHorizontal ? 1 : progress,
            floatingFlip: edge == .right ? 1 : 0, detachment: progress)
        let original = TimerSidebarGeometry(
            horizontal: edge.isHorizontal ? 1 : 0,
            floatingFlip: edge == .right ? 1 : 0, detachment: 0)
        let size = geometry.size
        let body = CGRect(origin: CGPoint(x: 180, y: 180), size: size)
        let gap = 140 * progress
        let anchor: CGPoint
        let contactX = body.minX + geometry.ring.x + original.size.width / 2 - original.ring.x
        let contactY = body.minY + geometry.ring.y + original.size.height / 2 - original.ring.y
        switch edge {
        case .right: anchor = CGPoint(x: body.maxX + gap, y: contactY)
        case .left: anchor = CGPoint(x: body.minX - gap, y: contactY)
        case .top: anchor = CGPoint(x: contactX, y: body.minY - gap)
        case .bottom: anchor = CGPoint(x: contactX, y: body.maxY + gap)
        }
        return TimerLiquidShape(bodyFrame: body, anchor: anchor, edge: edge, detachment: progress)
    }

    @MainActor func testActualFrostCoversTheFirstPixelsAndTheWholeNeck() throws {
        let size = CGSize(width: 640, height: 640)
        for edge in TimerSidebarEdge.allCases {
            for distance: CGFloat in [4, 8, 11, 20] {
                let shape = fixture(distance / 140, edge: edge)
                let view = TimerFrostedView(frame: CGRect(origin: .zero, size: size))
                view.updateMask(size: size, path: shape.path(in: .zero).cgPath)
                let mask = try XCTUnwrap(view.maskImage?.cgImage(forProposedRect: nil, context: nil, hints: nil))
                let pixels = NSBitmapImageRep(cgImage: mask)
                let anchor = try XCTUnwrap(shape.anchor)
                let center = CGPoint(x: shape.bodyFrame.midX, y: shape.bodyFrame.midY)
                // Sample the real native blur mask, not an unrelated shader's
                // output: every point from the body to the wall must be frosted.
                for step in 0..<100 {
                    let t = CGFloat(step) / 100
                    let point = CGPoint(
                        x: center.x + (anchor.x - center.x) * t, y: center.y + (anchor.y - center.y) * t)
                    let alpha =
                        pixels.colorAt(
                            x: Int(point.x / size.width * CGFloat(pixels.pixelsWide)),
                            y: Int(point.y / size.height * CGFloat(pixels.pixelsHigh)))?.alphaComponent ?? 0
                    XCTAssertGreaterThan(alpha, 0.95, "Missing frost at \(distance) points, \(edge), \(point)")
                }
            }
        }
    }

    func testNeckSeparatesAndBothDropsRetractOnEveryEdge() throws {
        for edge in TimerSidebarEdge.allCases {
            let shape = fixture(32 / 140, edge: edge)
            let anchor = try XCTUnwrap(shape.anchor)
            let body = shape.bodyFrame
            let contact: CGPoint
            switch edge {
            case .right: contact = CGPoint(x: body.maxX, y: body.midY)
            case .left: contact = CGPoint(x: body.minX, y: body.midY)
            case .top: contact = CGPoint(x: body.midX, y: body.minY)
            case .bottom: contact = CGPoint(x: body.midX, y: body.maxY)
            }
            let path = shape.path(in: .zero).cgPath
            func between(_ t: CGFloat) -> CGPoint {
                CGPoint(x: contact.x + (anchor.x - contact.x) * t, y: contact.y + (anchor.y - contact.y) * t)
            }
            XCTAssertTrue(path.contains(between(0.05)), "The body keeps a retracting tip")
            XCTAssertFalse(path.contains(between(0.5)), "The two drops have separated")
            XCTAssertTrue(path.contains(between(0.95)), "The wall keeps a retracting tip")
        }
    }

    func testContourFitsTheBodyAndOriginalWallFootprintWithoutClipping() {
        for edge in TimerSidebarEdge.allCases {
            for step in 0...140 {
                let shape = fixture(CGFloat(step) / 140, edge: edge)
                let bounds = shape.path(in: .zero).boundingRect
                let body = shape.bodyFrame
                let anchor = shape.anchor!
                let radius = TimerLiquidShape.wallRadius(edge: edge, gap: CGFloat(step))
                let footprint = CGRect(
                    x: anchor.x - radius, y: anchor.y - radius, width: radius * 2, height: radius * 2)
                let envelope = body.union(footprint)
                if edge.isHorizontal {
                    XCTAssertGreaterThanOrEqual(bounds.minX, envelope.minX - 0.001)
                    XCTAssertLessThanOrEqual(bounds.maxX, envelope.maxX + 0.001)
                } else {
                    XCTAssertGreaterThanOrEqual(bounds.minY, envelope.minY - 0.001)
                    XCTAssertLessThanOrEqual(bounds.maxY, envelope.maxY + 0.001)
                }
            }
        }
    }

    func testPinchDoesNotDeleteOrJumpTheSurvivingContours() {
        let before = fixture(TimerLiquidShape.separationDistance / 140 - 0.00001).path(in: .zero)
        let after = fixture(TimerLiquidShape.separationDistance / 140 + 0.00001).path(in: .zero)
        var changed = 0
        for x in 180..<510 {
            for y in 180..<450 {
                let point = CGPoint(x: Double(x) + 0.5, y: Double(y) + 0.5)
                if before.contains(point) != after.contains(point) { changed += 1 }
            }
        }
        XCTAssertLessThan(changed, 20, "Pinching must preserve the two lobes instead of removing a bridge")
    }

    func testNoProtrudingTailAfterTheShortRelease() {
        for edge in TimerSidebarEdge.allCases {
            for distance: CGFloat in [46, 56, 80, 112] {
                let shape = fixture(distance / 140, edge: edge)
                let body = TimerSidebarShape(edge: edge, detachment: shape.detachment).path(in: shape.bodyFrame)
                XCTAssertEqual(shape.path(in: .zero), body)
            }
        }
    }

    func testWallContactBeginsAtTheOriginalAttachmentSize() {
        for edge in TimerSidebarEdge.allCases {
            let original = TimerSidebarGeometry.size(for: edge)
            let halfLength = (edge.isHorizontal ? original.width : original.height) / 2
            XCTAssertEqual(TimerLiquidShape.wallRadius(edge: edge, gap: 0), halfLength)
            XCTAssertGreaterThan(TimerLiquidShape.wallRadius(edge: edge, gap: 1), halfLength * 0.99)
        }
    }

    func testBroaderShouldersKeepTheRingAndSettingsInside() {
        for edge in TimerSidebarEdge.allCases {
            for step in 1..<140 {
                let progress = CGFloat(step) / 140
                let shape = fixture(progress, edge: edge)
                let geometry = TimerSidebarGeometry(
                    horizontal: edge.isHorizontal ? 1 : progress,
                    floatingFlip: edge == .right ? 1 : 0, detachment: progress)
                let path = shape.path(in: .zero).cgPath
                for (center, radius) in [(geometry.ring, CGFloat(24)), (geometry.settings, CGFloat(18))] {
                    for sample in 0..<32 {
                        let angle = CGFloat(sample) * .pi / 16
                        let point = CGPoint(
                            x: shape.bodyFrame.minX + center.x + cos(angle) * radius,
                            y: shape.bodyFrame.minY + center.y + sin(angle) * radius)
                        XCTAssertTrue(path.contains(point), "Control clipped at \(step), \(edge), \(point)")
                    }
                }
            }
        }
    }

    func testRestingOutlinesAreUnchanged() {
        for edge in TimerSidebarEdge.allCases {
            for progress: CGFloat in [0, 1] {
                let shape = fixture(progress, edge: edge)
                XCTAssertEqual(
                    shape.path(in: .zero), TimerSidebarShape(edge: edge, detachment: progress).path(in: shape.bodyFrame)
                )
            }
        }
    }

    @MainActor func testRenderPullStages() throws {
        let size = CGSize(width: 640, height: 640)
        for distance: CGFloat in [0, 4, 11, 20, 27, 28, 30, 34, 40, 46, 80, 140] {
            let shape = fixture(distance / 140)
            let image = NSImage(size: size, flipped: true) { _ in
                NSColor(white: 0.14, alpha: 1).setFill()
                NSBezierPath(rect: CGRect(origin: .zero, size: size)).fill()
                guard let context = NSGraphicsContext.current?.cgContext else { return false }
                context.addPath(shape.path(in: .zero).cgPath)
                context.setFillColor(NSColor(white: 0.32, alpha: 1).cgColor)
                context.setStrokeColor(NSColor(white: 0.6, alpha: 1).cgColor)
                context.setLineWidth(0.75)
                context.drawPath(using: .fillStroke)
                return true
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "Frosted contour at \(Int(distance)) points"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
}
