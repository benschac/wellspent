import AppKit

@MainActor
final class TimerAppDelegate: NSObject, NSApplicationDelegate {
    let composition = TimerAppComposition()
    private lazy var focusShortcut = FocusGlobalShortcut { [weak self] in self?.composition.windows.showFocusWindow() }
    private lazy var statusItem = TimerStatusItemController(windows: composition.windows)
    private var terminationTask: Task<Void, Never>?
    private var isRunning = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hosted unit tests construct inert services and must not restore user windows.
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
        isRunning = true
        composition.start()
        statusItem.start()
        composition.windows.showMainWindow()
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
        // The floating panel can be visible even when every app window is closed.
        composition.windows.showMainWindow()
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminationTask != nil { return .terminateLater }
        guard isRunning else { return .terminateNow }
        terminationTask = Task {
            let canTerminate = await composition.shutdown()
            if canTerminate {
                isRunning = false
                statusItem.stop()
                focusShortcut.unregister()
                NSWorkspace.shared.notificationCenter.removeObserver(self)
            } else {
                composition.windows.showRecordingWindow()
                terminationTask = nil
            }
            sender.reply(toApplicationShouldTerminate: canTerminate)
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        statusItem.stop()
        focusShortcut.unregister()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    @objc private func refreshSidebar() {
        guard isRunning else { return }
        composition.sidebar.refreshAfterWorkspaceChange()
        composition.resumeFocus()
    }
}
