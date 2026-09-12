import SwiftUI

/// Applies the resizing policy to AppKit, which owns native divider gestures.
struct SettingsSidebarLock: NSViewRepresentable {
    func makeNSView(context: Context) -> SettingsSidebarLockView {
        SettingsSidebarLockView()
    }

    func updateNSView(_ view: SettingsSidebarLockView, context: Context) {
        view.lockSidebar()
    }
}
