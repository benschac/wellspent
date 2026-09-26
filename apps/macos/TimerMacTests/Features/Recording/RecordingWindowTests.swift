import AppKit
import SwiftUI
import Testing

@testable import TimerMac

@MainActor
struct RecordingWindowTests {
    @Test
    func hostedPreviewReusesWindowAndModelAndRendersCommittedSourcesAndGap() async throws {
        let name = "recording-window-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set("file:///recording-test", forKey: "apiBaseURL")
        defaults.set(false, forKey: "sidebarVisible")
        let store = RecordingModelRepositoryFixture()
        let recording = RecordingModel(repository: store, stamp: RecordingModelClockFixture().stamp)
        let app = TimerAppComposition(
            model: TimerModel(
                settingsStore: SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: [:])),
            focusAuth: FocusAuthModel(
                storage: FocusAuthStorage(read: { _ in nil }, write: { _, _ in Issue.record("Unexpected auth write") }),
                configurationDefaults: defaults, bundledConfiguration: [:]),
            defaults: defaults, recording: recording)
        app.windows.showRecordingWindow()
        recording.load()
        await recording.waitForIdle()
        #expect(await store.attempts.isEmpty, "Rendering may load/recover but cannot authorize a new recording")
        recording.startRecording()
        await recording.waitForIdle()
        recording.addApplicationSample()
        await recording.waitForIdle()
        recording.addAgentSample()
        await recording.waitForIdle()
        recording.addNoteSample()
        await recording.waitForIdle()
        recording.simulateGap()
        await recording.waitForIdle()

        let window = try #require(app.windows.mainWindow)
        let content = try #require(window.contentView)
        let identity = recording.current?.id
        window.performClose(nil)
        #expect(recording.current?.id == identity)
        #expect(await store.closeCount == 0)
        app.windows.showRecordingWindow()
        #expect(app.windows.mainWindow === window)
        #expect(window.contentView === content)
        #expect(app.windows.settingsWindow == nil, "Recording review belongs to the Timer, not Settings")
        app.windows.showMainWindow()
        #expect(app.windows.mainWindow === window)
        #expect(app.recording === recording)
        #expect(recording.current?.status == .suspended)
        #expect(app.model.isStarted == false)
        for size in [CGSize(width: 1200, height: 860), CGSize(width: 980, height: 700)] {
            window.setContentSize(size)
            content.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            let bitmap = try #require(content.bitmapImageRepForCachingDisplay(in: content.bounds))
            content.cacheDisplay(in: content.bounds, to: bitmap)
            let png = try #require(bitmap.representation(using: .png, properties: [:]))
            let screenshot = FileManager.default.temporaryDirectory.appendingPathComponent(
                "\(name)-\(Int(size.width)).png")
            try png.write(to: screenshot)
            print("Recording preview render: \(screenshot.path)")
            Attachment.record(png, named: "Timer recording workspace \(Int(size.width)).png")
        }
        #expect(await app.shutdown())
        #expect(window.contentView == nil)
        #expect(await store.closeCount == 1)
    }
}
