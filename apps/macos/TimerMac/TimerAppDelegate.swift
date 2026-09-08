import AppKit

@MainActor
final class TimerAppDelegate: NSObject, NSApplicationDelegate {
    let model = TimerModel()
    lazy var sidebar = TimerSidebarController(model: model)
    private lazy var focusShortcut = FocusGlobalShortcut { [weak self] in self?.sidebar.showFocusWindow() }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hosted unit tests should not put floating windows on the user's desktop.
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
        sidebar.restore()
        Task { await sidebar.prepareFocus() }
        do { try focusShortcut.register() } catch { sidebar.focusShortcutError = error.localizedDescription }
        for name in [NSWorkspace.activeSpaceDidChangeNotification, NSWorkspace.didWakeNotification] {
            NSWorkspace.shared.notificationCenter.addObserver(
                self, selector: #selector(refreshSidebar), name: name, object: nil
            )
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        Task { await sidebar.focusAuth.resume() }
    }

    func applicationDidChangeScreenParameters(_ notification: Notification) {
        sidebar.reposition()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        sidebar.show()
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        focusShortcut.unregister()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        sidebar.shutdown()
    }

    @objc private func refreshSidebar() {
        sidebar.refreshAfterWorkspaceChange()
        Task { await sidebar.focusAuth.resume() }
    }
}
