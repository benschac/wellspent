import AppKit
import LiquidUI
import SwiftUI
import XCTest

@testable import TimerMac

final class TimerHandleAppearanceTests: XCTestCase {
    func testShortenedHandleTracksContourWithTenPointClearance() throws {
        for collapse: CGFloat in [0, 1] {
            let geometry = TimerWidgetGeometry(horizontal: 0, detachment: 0, collapse: collapse, handleEdge: .right)
            var points: [CGPoint] = []
            // Path exposes elements through this callback, not Sequence.
            // swift-format-ignore: ReplaceForEachWithForLoop
            geometry.handleGeometry.path.forEach { element in
                switch element {
                case .move(let point), .line(let point): points.append(point)
                default: break
                }
            }
            let start = try XCTUnwrap(points.first)
            let end = try XCTUnwrap(points.last)
            let halfStroke = TimerHandleGeometry.lineWidth / 2
            XCTAssertGreaterThan(start.x, geometry.size.width - TimerSidebarGeometry.shoulder)
            XCTAssertGreaterThan(
                start.y - halfStroke - (geometry.size.height - TimerSidebarGeometry.shoulder), 10)
            XCTAssertGreaterThan(geometry.size.width - end.x - halfStroke, 10)
            XCTAssertLessThan(end.y + halfStroke, geometry.size.height)
            XCTAssertGreaterThan(end.y - start.y, 8)
            // Compare the entire grip against the actual container contour,
            // not just its endpoints or a duplicate of the offset formula.
            let container = TimerSidebarShape(edge: .right).path(in: CGRect(origin: .zero, size: geometry.size))
            let contour = lowerShoulderSamples(in: container)
            XCTAssertFalse(contour.isEmpty)
            for point in points {
                let distance = try XCTUnwrap(contour.map { hypot($0.x - point.x, $0.y - point.y) }.min())
                XCTAssertFalse(container.contains(point))
                XCTAssertEqual(distance - halfStroke, 10, accuracy: 0.02)
            }
        }
    }

    private func lowerShoulderSamples(in path: Path) -> [CGPoint] {
        var current = CGPoint.zero
        var samples: [CGPoint] = []
        // Path exposes elements through this callback, not Sequence.
        // swift-format-ignore: ReplaceForEachWithForLoop
        path.forEach { element in
            switch element {
            case .move(let point), .line(let point): current = point
            case .curve(let end, let first, let second):
                let start = current
                // The last cubic is the lower wall-facing corner.
                samples = (0...1000).map { step in
                    let t = CGFloat(step) / 1000
                    let u = 1 - t
                    return CGPoint(
                        x: u * u * u * start.x + 3 * u * u * t * first.x + 3 * u * t * t * second.x + t * t * t * end.x,
                        y: u * u * u * start.y + 3 * u * u * t * first.y + 3 * u * t * t * second.y + t * t * t * end.y)
                }
                current = end
            case .quadCurve(let end, _): current = end
            case .closeSubpath: break
            }
        }
        return samples
    }

    @MainActor func testRenderExteriorHandlePreviews() throws {
        for collapsed in [false, true] {
            let suite = "timer-handle-preview-\(UUID().uuidString)"
            let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
            defer { defaults.removePersistentDomain(forName: suite) }
            defaults.set("file:///timer-test", forKey: "apiBaseURL")
            defaults.set(collapsed, forKey: "sidebarCollapsed")
            let model = TimerModel(
                settingsStore: SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: [:]))
            let sidebar = TimerSidebarController(model: model, defaults: defaults)
            let geometry = sidebar.geometry
            let view = TimerSidebarView()
                .environment(model).environment(sidebar)
                .frame(width: geometry.size.width, height: geometry.size.height + 16)
                .padding(24)
                .background(Color(white: 0.15))
            // Native hosting is required: ImageRenderer substitutes warning
            // placeholders for the AppKit drag targets and frosted backdrop.
            let host = NSHostingView(rootView: view)
            let size = CGSize(width: geometry.size.width + 48, height: geometry.size.height + 64)
            let window = NSWindow(
                contentRect: CGRect(origin: .zero, size: size),
                styleMask: .borderless, backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.appearance = NSAppearance(named: .darkAqua)
            window.contentView = host
            defer { window.close() }
            host.frame = CGRect(origin: .zero, size: size)
            host.layoutSubtreeIfNeeded()
            host.displayIfNeeded()
            let bitmap = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.cacheDisplay(in: host.bounds, to: bitmap)
            let image = NSImage(size: size)
            image.addRepresentation(bitmap)
            let attachment = XCTAttachment(image: image)
            attachment.name = collapsed ? "Collapsed exterior handle" : "Expanded exterior handle"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
}
