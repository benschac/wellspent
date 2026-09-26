import AppKit
import SwiftUI
import Testing

@testable import TimerMac

@MainActor
struct RecordingControlStabilityWindowTests {
    @Test(.timeLimit(.minutes(1)))
    func runningTimerAndDelayedCodexACKKeepRecordingPixelsStable() async throws {
        let fixture = try await RecordingTelemetryFixture.make()
        defer { fixture.store.remove() }
        let name = "control-stability-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        // Enables the unchecked control without authorizing or starting a source reader.
        defaults.set(Data([0]), forKey: "codexCaptureDirectoryBookmark")
        defaults.set("file:///control-stability-test", forKey: "apiBaseURL")
        let model = RecordingModel(
            repository: fixture.repository, localScopeID: "local",
            stamp: RecordingModelClockFixture().stamp, telemetryPreferences: defaults)
        model.load()
        await model.waitForIdle()
        model.tasks.createRecordingTask(title: "Synthetic task")
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        model.recordForegroundApplication(
            .init(bundleIdentifier: "test.editor", localizedName: "Synthetic Editor", processIdentifier: 42))
        await model.waitForIdle()

        let timer = TimerModel(
            settingsStore: SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: [:]))
        let host = NSHostingView(
            rootView: VStack {
                TimerReadoutView().environment(timer).padding()
                RecordingWindowView().environment(model)
            }
            .background(Color(nsColor: .windowBackgroundColor)).preferredColorScheme(.dark))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 860),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "SYNTHETIC · Recording control stability · disposable store"
        window.contentView = host
        window.center()
        window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        timer.start()
        timer.startOrResume()
        try await Task.sleep(for: .milliseconds(500))
        let baseline = try recordingPixels(in: host)

        let packet = try #require(fixture.packets.first)
        var releaseACK: CheckedContinuation<Void, Never>?
        let delivery = Task {
            try await model.receiveLocalCodexTelemetry(packet.packet, bindingID: packet.bindingID) { _ in
                await withCheckedContinuation { releaseACK = $0 }
            }
        }
        while releaseACK == nil { await Task.yield() }
        defer { releaseACK?.resume() }
        let started = timer.displayElapsedMilliseconds
        for _ in 0..<8 {
            try await Task.sleep(for: .milliseconds(250))
            host.layoutSubtreeIfNeeded()
            #expect(model.isBusy, "The old interval's ACK deliberately holds the write gate")
            #expect(model.canConfigureRecording)
            #expect(model.tasks.canEditTasks)
            #expect(model.tasks.canSelectRecordingTask)
            #expect(
                try recordingPixels(in: host) == baseline,
                "The entire recording workspace must retain its pixels across timer ticks and background IO")
        }
        #expect(timer.displayElapsedMilliseconds > started + 1_000)
        host.displayIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        let screenshot = FileManager.default.temporaryDirectory.appendingPathComponent("timer-control-stability.png")
        try png.write(to: screenshot)
        print("Native control stability render: \(screenshot.path)")
        Attachment.record(png, named: "Running timer during delayed Codex ACK.png")

        model.tasks.createRecordingTask(title: "Queued during ACK")
        #expect(model.tasks.hasPendingTaskAction)
        releaseACK?.resume()
        releaseACK = nil
        _ = try await delivery.value
        await model.waitForIdle()
        #expect(model.tasks.taskAttribution.tasks.contains { $0.title == "Queued during ACK" })
        timer.pause()
        await timer.shutdown()
        #expect(await model.shutdown())
    }

    private func recordingPixels(in view: NSView) throws -> Data {
        view.layoutSubtreeIfNeeded()
        view.displayIfNeeded()
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        let image = try #require(bitmap.cgImage)
        // Only the timer readout occupies the first 80 points; every recording control,
        // timeline row and label remains in the comparison below it.
        let top = Int(80 * CGFloat(image.height) / view.bounds.height)
        let recording = try #require(
            image.cropping(
                to: CGRect(
                    x: 0, y: top, width: image.width, height: image.height - top)))
        return try #require(NSBitmapImageRep(cgImage: recording).representation(using: .png, properties: [:]))
    }
}
