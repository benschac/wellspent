import AppKit
import Testing

@testable import TimerMac

@MainActor
@Suite(.serialized, .timeLimit(.minutes(1)))
struct TimerAppCompositionTests {
    @Test
    func timerButtonRoutesThroughRecordingLifecycle() async throws {
        let suite = "timer-recording-wiring-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let app = makeComposition(defaults: defaults)
        #expect(app.sidebar.recordingControls === app.recordingControls)
        app.sidebar.toggleTimer()
        await app.recordingControls.waitForIdle()
        #expect(app.model.isRunning)
        #expect(app.recording.canCaptureForegroundApplications)
        app.sidebar.toggleTimer()
        await app.recordingControls.waitForIdle()
        #expect(!app.model.isRunning)
        #expect(app.recording.current?.status == .paused)
        await app.shutdown()
    }

    @Test
    func constructionIsInertAndLifecycleIsExplicitAndTerminal() async throws {
        let suite = "timer-lifecycle-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let app = makeComposition(defaults: defaults)
        #expect(!app.model.isStarted)
        #expect(app.model.errorMessage == nil)
        #expect(app.focusAuth.configuration == nil)
        #expect(!app.sidebar.isVisible)
        #expect(app.windows.mainWindow == nil)

        app.start()
        #expect(app.model.isStarted)
        #expect(app.model.errorMessage == "The configured API URL is invalid.")
        app.model.dismissError()
        app.start()
        #expect(app.model.errorMessage == nil, "Repeated app startup must not reconnect the model")
        await app.shutdown()
        #expect(!app.model.isStarted)
        #expect(app.model.connectionState == .disconnected)
        app.start()
        app.model.start()
        #expect(!app.model.isStarted, "A finished transport stream cannot be restarted")
        await app.shutdown()
    }

    @Test
    func hostedDestinationsReuseWindowsAndKeepFocusDrafts() async throws {
        let suite = "timer-windows-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let app = makeComposition(defaults: defaults)
        await app.prepareFocus()
        app.focusModel.intention = "Keep this intention"
        app.focusModel.note = "Keep this note"
        app.focusModel.recap = "Keep this recap"
        let windows = app.windows
        defer { windows.shutdown() }

        windows.showFocusWindow()
        let focusWindow = try #require(windows.focusWindow)
        let focusContent = try #require(focusWindow.contentView)
        focusContent.layoutSubtreeIfNeeded()
        focusWindow.performClose(nil)
        #expect(!focusWindow.isVisible)
        windows.showFocusWindow()
        #expect(windows.focusWindow === focusWindow)
        #expect(focusWindow.contentView === focusContent)
        #expect(focusWindow.isVisible)
        #expect(!focusWindow.isReleasedWhenClosed)
        #expect(focusWindow.isMovableByWindowBackground)
        #expect(focusWindow.standardWindowButton(.closeButton)?.isHidden == true)

        // The widget's injected actions route to the same coordinator as app commands.
        app.sidebar.openSettings()
        let settingsWindow = try #require(windows.settingsWindow)
        let settingsContent = try #require(settingsWindow.contentView)
        settingsContent.layoutSubtreeIfNeeded()
        settingsWindow.performClose(nil)
        app.sidebar.openSettings()
        #expect(windows.settingsWindow === settingsWindow)
        #expect(settingsWindow.contentView === settingsContent)
        #expect(settingsWindow.appearance?.name == .darkAqua)

        app.sidebar.openTimerWindow()
        let timerWindow = try #require(windows.mainWindow)
        let timerContent = try #require(timerWindow.contentView)
        timerContent.layoutSubtreeIfNeeded()
        timerWindow.performClose(nil)
        app.sidebar.openTimerWindow()
        #expect(windows.mainWindow === timerWindow)
        #expect(timerWindow.contentView === timerContent)
        await app.prepareFocus()
        #expect(app.focusModel.intention == "Keep this intention")
        #expect(app.focusModel.note == "Keep this note")
        #expect(app.focusModel.recap == "Keep this recap")
        #expect(!app.model.isStarted, "Window presentation must not start the transport")
        windows.shutdown()
        #expect(focusWindow.contentView == nil)
        #expect(settingsWindow.contentView == nil)
        #expect(timerWindow.contentView == nil)
        #expect(app.focusModel.note == "Keep this note")
        await app.shutdown()
    }

    @Test
    func compositionWiresAuthenticationRejectionWithoutDiscardingSameAccountDrafts() async throws {
        let suite = "timer-auth-wiring-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let app = makeComposition(defaults: defaults)
        await app.prepareFocus()
        app.focusModel.intention = "Draft"
        app.focusModel.note = "Unsent note"
        let connection = try #require(app.focusModel.authenticatedConnection)
        await #expect(throws: FocusAuthError.self) { try await connection() }
        let reject = try #require(app.focusModel.authenticationRejected)
        reject()
        #expect(app.focusAuth.needsSignIn)
        #expect(app.focusAuth.message == FocusAuthError.expired.localizedDescription)
        #expect(!app.focusModel.canWrite)
        #expect(app.focusModel.intention == "Draft")
        #expect(app.focusModel.note == "Unsent note")
        await app.shutdown()
    }

    private func makeComposition(defaults: UserDefaults) -> TimerAppComposition {
        defaults.set("file:///timer-test", forKey: "apiBaseURL")
        defaults.set(false, forKey: "sidebarVisible")
        let model = TimerModel(
            settingsStore: SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: [:]))
        let auth = FocusAuthModel(
            storage: FocusAuthStorage(
                read: { _ in nil }, write: { _, _ in Issue.record("Unexpected credential write") }),
            configurationDefaults: defaults, bundledConfiguration: [:])
        return TimerAppComposition(
            model: model, focusAuth: auth, defaults: defaults,
            recording: RecordingModel(repository: RecordingModelRepositoryFixture()))
    }
}
