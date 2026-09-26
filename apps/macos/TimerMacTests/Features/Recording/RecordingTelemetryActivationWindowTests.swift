import AppKit
import SwiftUI
import Testing

@testable import TimerMac

/// Without HOLD this proves hosted rendering after production ingestion, not user input.
/// With HOLD only a native button press can authorize; the source appender waits for it.
@MainActor
struct RecordingTelemetryActivationWindowTests {
    @Test(.timeLimit(.minutes(12)))
    func hostedActivationAndReviewUsingProductionIngestion() async throws {
        let fixture = try RecordingTelemetryActivationFixture()
        let model = fixture.makeModel()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 860),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        defer { window.close() }
        do {
            try await fixture.start()
            try await fixture.startRecording(model)
            let recording = try #require(model.current)
            let interval = try #require(recording.activeIntervalID)
            let host = NSHostingView(
                rootView: RecordingWindowView().environment(model)
                    .background(Color(nsColor: .windowBackgroundColor)).preferredColorScheme(.dark))
            window.title = "SYNTHETIC · Opt-in Codex activation · disposable store"
            window.contentView = host
            window.center()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            model.codex.start()
            print("C4 activation host PID: \(ProcessInfo.processInfo.processIdentifier)")
            print("C4 activation host executable: \(Bundle.main.executableURL?.path ?? "unknown")")
            print("C4 activation disposable store: \(fixture.store.path)")
            print("C4 activation synthetic source: \(fixture.source.path)")
            let requested =
                Int(ProcessInfo.processInfo.environment["WELLSPENT_TELEMETRY_ACTIVATION_HOLD_SECONDS"] ?? "0") ?? 0
            let seconds = min(max(requested, 0), 600)
            var appended = false
            if seconds > 0 {
                print(
                    "C4 activation ready for \(seconds) seconds: Connections → Authorize selected source → Done → Pause recording → Codex telemetry"
                )
                print(
                    "C4 activation metadata is NOT seeded. Two source records append one second after native authorization."
                )
                let started = ContinuousClock.now
                while started.duration(to: .now) < .seconds(seconds) {
                    if model.telemetry.isCollecting && !appended {
                        try await Task.sleep(for: .seconds(1))
                        try fixture.append()
                        appended = true
                        print(
                            "C4 activation synthetic config/individual usage appended; pause after the next intake poll"
                        )
                    }
                    try await Task.sleep(for: .milliseconds(100))
                }
                try #require(appended, "Native source authorization was not exercised during the interaction window")
                try #require(
                    model.acceptingEvents == false,
                    "Pause or Finish must be exercised through the native recording controls")
            } else {
                // Automated branch uses the production actions; it makes no claim about keyboard or VoiceOver.
                try await fixture.authorize(model)
                try fixture.append()
                appended = true
                await model.telemetry.readIfAuthorized()
                await model.waitForIdle()
                model.pause()
                await model.waitForIdle()
                await model.telemetry.waitForIdle()
            }
            await model.codex.stop()
            await model.waitForIdle()
            for _ in 0..<2 { _ = await model.codex.pollOnce() }
            let observations = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval)
            #expect(observations.count == 2)
            #expect(
                observations.first { $0.metadata.kind == "turnConfiguration" }?.metadata.configuredModel == "gpt-6-sol")
            #expect(observations.first { $0.metadata.kind == "responseUsage" }?.metadata.usage?.totalTokens == 1290)
            try await Task.sleep(for: .milliseconds(250))
            host.layoutSubtreeIfNeeded()
            try record(host)
            window.selectNextKeyView(nil)
            print("C4 activation hosted focus responder: \(String(describing: window.firstResponder))")
            print(
                "C4 activation VoiceOver spoken navigation requires an operator check; screenshot and focus are separate evidence"
            )
            #expect(appended)
            #expect(await model.shutdown())
            await fixture.cleanup()
        } catch {
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }

    private func record(_ host: NSView) throws {
        host.displayIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(
            "C4-opt-in-activation-review-\(UUID()).png")
        try png.write(to: path)
        Attachment.record(png, named: "C4-opt-in-activation-review.png")
        print("C4 activation review screenshot: \(path.path)")
    }
}
