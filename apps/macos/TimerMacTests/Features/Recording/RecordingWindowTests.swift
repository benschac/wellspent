import AppKit
import SwiftUI
import Testing

@testable import TimerMac

@MainActor
struct RecordingWindowTests {
    @Test(.timeLimit(.minutes(1)))
    func codexDeliveryDoesNotFlashHeaderControlsOrTelemetry() async throws {
        let fixture = try await RecordingTelemetryFixture.make()
        defer { fixture.store.remove() }
        let model = RecordingModel(
            repository: fixture.repository, localScopeID: "local",
            stamp: { fixture.store.event(.start, at: 100).stamp })
        model.load()
        await model.waitForIdle()
        model.selectedID = fixture.recordingID
        let host = NSHostingView(
            rootView: RecordingWindowView().environment(model)
                .background(Color(nsColor: .windowBackgroundColor)).preferredColorScheme(.dark))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 860),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        let packet = try #require(
            try fixture.packets.first {
                try CodexTelemetryContract.parse($0.packet.body).intervalID == fixture.secondIntervalID
            })
        for phase in ["finished", "recording", "paused"] {
            if phase == "recording" {
                model.startForegroundApplicationRecording()
                await model.waitForIdle()
                model.selectedID = fixture.recordingID
            } else if phase == "paused" {
                model.pause()
                await model.waitForIdle()
            }
            try await Task.sleep(for: .milliseconds(500))
            let scroll = try #require(scrollViews(in: host).max { $0.frame.width < $1.frame.width })
            scroll.contentView.scroll(to: NSPoint(x: 0, y: 160))
            scroll.reflectScrolledClipView(scroll.contentView)
            try await Task.sleep(for: .milliseconds(100))
            let baseline = try pixels(in: host)
            let scrollOrigin = scroll.contentView.bounds.origin
            #expect(scrollOrigin.y > 0)
            var release: CheckedContinuation<Void, Never>?
            let delivery = Task {
                try await model.receiveLocalCodexTelemetry(packet.packet, bindingID: packet.bindingID) { _ in
                    await withCheckedContinuation { release = $0 }
                }
            }
            while release == nil { await Task.yield() }
            // Give SwiftUI a render pass while the real intake operation holds its ACK gate.
            try await Task.sleep(for: .milliseconds(100))
            let duringDelivery = try pixels(in: host)
            #expect(duringDelivery == baseline, "Codex ACK changed the \(phase) recording UI")
            #expect(scroll.contentView.bounds.origin == scrollOrigin)
            Attachment.record(duringDelivery, named: "Codex delivery stable \(phase).png")
            let screenshot = FileManager.default.temporaryDirectory.appendingPathComponent(
                "codex-delivery-\(phase)-\(UUID()).png")
            try duringDelivery.write(to: screenshot)
            print("Codex delivery scroll render: \(screenshot.path)")
            release?.resume()
            _ = try await delivery.value
            try await Task.sleep(for: .milliseconds(100))
            #expect(try pixels(in: host) == baseline)
            #expect(scroll.contentView.bounds.origin == scrollOrigin)
        }
        #expect(await model.shutdown())
    }

    @Test(.timeLimit(.minutes(1)))
    func backgroundSaveDoesNotFlashSelectedHistory() async throws {
        let store = RecordingModelRepositoryFixture()
        let model = RecordingModel(repository: store, stamp: RecordingModelClockFixture().stamp)
        model.load()
        await model.waitForIdle()
        model.startRecording()
        await model.waitForIdle()
        let finishedID = try #require(model.selected?.id)
        model.finish()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        model.selectedID = finishedID

        let host = NSHostingView(rootView: RecordingWindowView().environment(model))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 860),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        try await Task.sleep(for: .milliseconds(500))
        let baseline = try pixels(in: host)

        await store.holdNextCommit()
        model.recordForegroundApplication(nil)
        await store.waitUntilCommitHeld()
        #expect(try pixels(in: host) == baseline)
        await store.releaseCommit()
        await model.waitForIdle()
        #expect(try pixels(in: host) == baseline)
    }

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

    private func pixels(in view: NSView) throws -> Data {
        view.layoutSubtreeIfNeeded()
        view.displayIfNeeded()
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return try #require(bitmap.representation(using: .png, properties: [:]))
    }

    private func scrollViews(in view: NSView) -> [NSScrollView] {
        (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap { scrollViews(in: $0) }
    }
}
