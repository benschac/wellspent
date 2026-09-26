import LiquidUI
import SwiftUI
import Testing

@testable import TimerMac

struct TimerWidgetGeometryTests {
    @Test func ringStaysInsideAndHandleStaysOutsideEveryCollapsedOutline() {
        let edges: [TimerSidebarEdge?] = [.left, .right, .top, .bottom, nil]
        for edge in edges {
            for collapse: CGFloat in [0, 0.25, 0.5, 0.75, 1] {
                let geometry = TimerWidgetGeometry(
                    horizontal: edge?.isHorizontal == false ? 0 : 1,
                    floatingFlip: edge == .right ? 1 : 0,
                    detachment: edge == nil ? 1 : 0, collapse: collapse, handleEdge: edge)
                let path = TimerSidebarShape(edge: edge).path(in: CGRect(origin: .zero, size: geometry.size))
                for step in 0..<32 {
                    let angle = Double(step) * .pi / 16
                    #expect(
                        path.contains(
                            CGPoint(
                                x: geometry.ring.x + cos(angle) * 24,
                                y: geometry.ring.y + sin(angle) * 24)))
                }
                let grip = geometry.handleGeometry.hitPath
                let bounds = grip.boundingRect
                for x in stride(from: bounds.minX, through: bounds.maxX, by: 1) {
                    for y in stride(from: bounds.minY, through: bounds.maxY, by: 1) {
                        let point = CGPoint(x: x, y: y)
                        if grip.contains(point) { #expect(!path.contains(point)) }
                    }
                }
            }
        }
    }

    @Test func liquidContactUsesTheActualExpandedOrCollapsedFootprint() {
        for edge in TimerSidebarEdge.allCases {
            for collapse: CGFloat in [0, 1] {
                let size = TimerSidebarLayout.size(for: edge, collapse: collapse)
                let length = edge.isHorizontal ? size.width : size.height
                #expect(TimerLiquidShape.wallRadius(edge: edge, gap: 0, attachmentLength: length) == length / 2)
                #expect(TimerLiquidShape.wallRadius(edge: edge, gap: 1, attachmentLength: length) > length / 2 * 0.99)
                #expect(TimerLiquidShape.wallRadius(edge: edge, gap: 46, attachmentLength: length) == 0)
            }
        }
    }

    @Test func collapsingKeepsRingAtTheSameScreenPoint() {
        let anchor = CGPoint(x: -450, y: 620)
        for horizontal: CGFloat in [0, 0.5, 1] {
            for flip: CGFloat in [0, 1] {
                for step in 0...100 {
                    let geometry = TimerWidgetGeometry(
                        horizontal: horizontal, floatingFlip: flip, collapse: CGFloat(step) / 100)
                    let frame = geometry.frame(holding: anchor)
                    #expect(abs(frame.minX + geometry.ring.x - anchor.x) < 0.001)
                    #expect(abs(frame.maxY - geometry.ring.y - anchor.y) < 0.001)
                }
            }
        }
    }

    @Test func collapsedDropAndRestoreUseCompactDimensions() {
        let screen = CGRect(x: -1440, y: 50, width: 1440, height: 850)
        let drop = CGRect(x: -700, y: 400, width: 80, height: 80)
        let placement = TimerSidebarLayout.placement(
            afterDropping: drop, in: screen, displayID: nil, magneticEdges: false,
            preferredEdge: nil, collapse: 1)
        let restored = TimerSidebarLayout.frame(for: placement, in: screen, collapse: 1)
        #expect(abs(restored.midX - drop.midX) < 0.001)
        #expect(abs(restored.midY - drop.midY) < 0.001)
        #expect(restored.size == drop.size)
        for edge in TimerSidebarEdge.allCases {
            let frame = TimerSidebarLayout.frame(
                for: TimerSidebarPlacement(edge: edge), in: screen, collapse: 1)
            #expect(screen.contains(frame))
            let geometry = TimerWidgetGeometry(
                horizontal: edge.isHorizontal ? 1 : 0, detachment: 0, collapse: 1, handleEdge: edge)
            let handle = geometry.handleFrame
            let screenHandle = CGRect(
                x: frame.minX + handle.minX, y: frame.maxY - handle.maxY,
                width: handle.width, height: handle.height)
            #expect(screen.contains(screenHandle))
        }
    }

    @Test @MainActor func collapsedPreferenceRestoresWithoutChangingPositionLock() throws {
        let suite = "timer-collapse-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("file:///timer-test", forKey: "apiBaseURL")
        defaults.set(true, forKey: "sidebarPositionLocked")
        defaults.set(true, forKey: "sidebarCollapsed")
        let model = TimerModel(
            settingsStore: SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: [:]))
        let sidebar = TimerSidebarController(model: model, defaults: defaults)
        #expect(sidebar.isCollapsed)
        #expect(sidebar.collapse == 1)
        #expect(sidebar.isPositionLocked)
        #expect(sidebar.geometry.contentOpacity == 0)
    }
}
