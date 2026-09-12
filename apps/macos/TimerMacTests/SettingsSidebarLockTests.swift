import AppKit
import SwiftUI
import XCTest

@testable import TimerMac

final class SettingsSidebarLockTests: XCTestCase {
    @MainActor func testHostedSidebarRejectsNativeCollapseAndResize() async throws {
        let root = NavigationSplitView(columnVisibility: .constant(.all)) {
            Text("Accounts")
                .frame(width: 220)
                .navigationSplitViewColumnWidth(220)
                .background(SettingsSidebarLock())
                .toolbar(removing: .sidebarToggle)
        } detail: {
            Text("Settings").frame(minWidth: 500, minHeight: 400)
        }
        let host = NSHostingController(rootView: root)
        let window = NSWindow(contentViewController: host)
        window.setContentSize(CGSize(width: 860, height: 680))
        defer { window.close() }
        host.view.layoutSubtreeIfNeeded()
        await Task.yield()
        host.view.layoutSubtreeIfNeeded()

        func findSplitView(in view: NSView) -> NSSplitView? {
            if let split = view as? NSSplitView { return split }
            for child in view.subviews {
                if let split = findSplitView(in: child) { return split }
            }
            return nil
        }

        let split = try XCTUnwrap(findSplitView(in: host.view))
        let controller = try XCTUnwrap(split.delegate as? NSSplitViewController)
        let item = try XCTUnwrap(controller.splitViewItems.first { $0.behavior == .sidebar })
        XCTAssertFalse(item.canCollapse)
        XCTAssertFalse(item.canCollapseFromWindowResize)
        XCTAssertEqual(item.minimumThickness, 220)
        XCTAssertEqual(item.maximumThickness, 220)

        controller.toggleSidebar(nil)
        host.view.layoutSubtreeIfNeeded()
        XCTAssertFalse(item.isCollapsed, "The native sidebar action must not close settings navigation")

        window.setContentSize(CGSize(width: 740, height: 580))
        host.view.layoutSubtreeIfNeeded()
        XCTAssertFalse(item.isCollapsed)
        XCTAssertEqual(item.viewController.view.frame.width, 220, accuracy: 1)

        for position: CGFloat in [0, 400] {
            split.setPosition(position, ofDividerAt: 0)
            host.view.layoutSubtreeIfNeeded()
            XCTAssertFalse(item.isCollapsed)
            XCTAssertEqual(item.viewController.view.frame.width, 220, accuracy: 1)
        }
    }
}
