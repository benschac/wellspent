import AppKit

/// Owns the icon-only menu-bar shortcut to the app's main window.
@MainActor
final class TimerStatusItemController {
    private let windows: TimerWindowCoordinator
    private var statusItem: NSStatusItem?

    var isStarted: Bool { statusItem != nil }
    var showsTitle: Bool { statusItem?.button?.title.isEmpty == false }

    init(windows: TimerWindowCoordinator) {
        self.windows = windows
    }

    func start() {
        guard statusItem == nil else { return }

        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "timer", accessibilityDescription: nil)
            button.imagePosition = .imageOnly
            button.title = ""
            button.setAccessibilityLabel("Open Timer")
            button.target = self
            button.action = #selector(showApp)
            button.sendAction(on: [.leftMouseUp])
        }

        self.statusItem = statusItem
    }

    func stop() {
        if let statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
        }
        statusItem = nil
    }

    @objc func showApp() {
        windows.showMainWindow()
    }
}
