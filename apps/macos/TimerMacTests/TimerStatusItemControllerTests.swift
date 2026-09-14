import AppKit
import Testing

@testable import TimerMac

@MainActor
@Suite(.serialized)
struct TimerStatusItemControllerTests {
    @Test
    func statusItemIsIconOnlyAndOpensTheAppWindow() throws {
        let suite = "timer-status-item-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("file:///timer-test", forKey: "apiBaseURL")
        defaults.set(false, forKey: "sidebarVisible")

        let app = TimerAppComposition(
            model: TimerModel(
                settingsStore: SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: [:])),
            focusAuth: FocusAuthModel(
                storage: FocusAuthStorage(read: { _ in nil }, write: { _, _ in }),
                configurationDefaults: defaults, bundledConfiguration: [:]),
            defaults: defaults,
            recording: RecordingModel(repository: RecordingModelRepositoryFixture()))
        let statusItem = TimerStatusItemController(windows: app.windows)
        defer {
            statusItem.stop()
            app.windows.shutdown()
        }

        #expect(!statusItem.isStarted)
        statusItem.start()
        #expect(statusItem.isStarted)
        #expect(!statusItem.showsTitle)
        statusItem.start()
        #expect(statusItem.isStarted, "Repeated startup must reuse the same status item")
        statusItem.showApp()
        #expect(app.windows.mainWindow?.isVisible == true)
        statusItem.stop()
        #expect(!statusItem.isStarted)
        #expect(!statusItem.showsTitle)
    }
}
