import AppKit

@MainActor
final class TimerAppDelegate: NSObject, NSApplicationDelegate {
    let composition = TimerAppComposition()
    private lazy var focusShortcut = FocusGlobalShortcut { [weak self] in self?.composition.windows.showFocusWindow() }
    private var terminationTask: Task<Void, Never>?
    private var isRunning = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hosted unit tests construct inert services and must not restore user windows.
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
        isRunning = true
        composition.start()
        do { try focusShortcut.register() } catch {
            composition.windows.focusShortcutError = error.localizedDescription
        }
        for name in [NSWorkspace.activeSpaceDidChangeNotification, NSWorkspace.didWakeNotification] {
            NSWorkspace.shared.notificationCenter.addObserver(
                self, selector: #selector(refreshSidebar), name: name, object: nil
            )
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        guard isRunning else { return }
        composition.resumeFocus()
    }

    func applicationDidChangeScreenParameters(_ notification: Notification) {
        guard isRunning else { return }
        composition.sidebar.reposition()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard isRunning else { return false }
        composition.sidebar.show()
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminationTask != nil { return .terminateLater }
        guard isRunning else { return .terminateNow }
        isRunning = false
        focusShortcut.unregister()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        terminationTask = Task {
            await composition.shutdown()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        focusShortcut.unregister()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    @objc private func refreshSidebar() {
        guard isRunning else { return }
        composition.sidebar.refreshAfterWorkspaceChange()
        composition.resumeFocus()
    }
}
