import AppKit
import SwiftUI
import Testing

@testable import TimerMac

/// HOLD opens the actual setup and recording UI against an empty disposable store.
/// It never selects a directory, toggles consent, starts, pauses, resumes or finishes for the operator.
@MainActor
struct AutomaticCodexCaptureWindowTests {
    @Test(.timeLimit(.minutes(12)))
    func hostedAutomaticSetupRecordingAndReview() async throws {
        let fixture = try AutomaticCodexCaptureFixture()
        try await fixture.start()
        let model = fixture.makeModel()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 900),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        defer { window.close() }
        do {
            try fixture.createSession("one")
            try fixture.createSession("two")
            try fixture.append("one", turn: "historical-one")
            try fixture.append("two", turn: "historical-two")
            await fixture.load(model)
            #expect(model.recordings.isEmpty)
            let host = NSHostingView(
                rootView: RecordingWindowView().environment(model)
                    .background(Color(nsColor: .windowBackgroundColor)).preferredColorScheme(.dark))
            window.title = "SYNTHETIC · Automatic Codex capture · disposable store"
            window.contentView = host
            window.center()
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            model.codex.start()
            print("C4 automatic host PID: \(ProcessInfo.processInfo.processIdentifier)")
            print("C4 automatic host executable: \(Bundle.main.executableURL?.path ?? "unknown")")
            print("C4 automatic disposable store: \(fixture.activation.store.path)")
            print("C4 automatic synthetic directory: \(fixture.directory.path)")
            print(
                "C4 automatic finish inspection by creating: \(fixture.activation.root.appendingPathComponent("interaction-done").path)"
            )
            let requested =
                Int(ProcessInfo.processInfo.environment["WELLSPENT_AUTOMATIC_CODEX_HOLD_SECONDS"] ?? "0") ?? 0
            let seconds = min(max(requested, 0), 600)
            var appended: [UUID: Set<String>] = [:]
            var intervals: [UUID] = []
            var appendedPauseGap = false
            if seconds > 0 {
                print(
                    "C4 automatic ready: Connections → Authorize session directory… → select printed synthetic directory → Include Codex activity → Done → Start recording → Pause → Resume → Finish → review."
                )
                let started = ContinuousClock.now
                while started.duration(to: .now) < .seconds(seconds) {
                    if model.current?.status == .paused, intervals.count == 1, !appendedPauseGap {
                        try fixture.append("one", turn: "paused-one-must-be-excluded")
                        try fixture.append("two", turn: "paused-two-must-be-excluded")
                        appendedPauseGap = true
                        print(
                            "C4 automatic appended synthetic pause-gap metadata; explicit Resume must baseline past it")
                    }
                    if let interval = model.current?.activeIntervalID, model.acceptingEvents {
                        if !intervals.contains(interval) {
                            intervals.append(interval)
                            if intervals.count == 2 {
                                // Emulates a third ordinary instance being opened after the user's explicit Resume.
                                try fixture.createSession("three")
                                try fixture.append("three", turn: "before-enrollment-three")
                                print(
                                    "C4 automatic third synthetic instance created after user Resume; enrollment baseline pending"
                                )
                            }
                        }
                        let expected = intervals.count == 1 ? 2 : 3
                        if model.telemetry.automatic.isCollecting && model.telemetry.automatic.sourceCount == expected {
                            let sessions = expected == 2 ? ["one", "two"] : ["one", "two", "three"]
                            for session in sessions where appended[interval, default: []].contains(session) == false {
                                try fixture.append(session, turn: "interval-\(intervals.count)-\(session)")
                                appended[interval, default: []].insert(session)
                                print(
                                    "C4 automatic appended synthetic configuration and response for interval \(intervals.count), instance \(session); normal native polling owns reads"
                                )
                            }
                        }
                    }
                    if FileManager.default.fileExists(
                        atPath: fixture.activation.root.appendingPathComponent("interaction-done").path)
                    {
                        break
                    }
                    try await Task.sleep(for: .milliseconds(100))
                }
                try #require(
                    intervals.count == 2, "The user must Start, Pause and explicitly Resume through native controls")
                try #require(model.current == nil, "The user must Finish through native controls")
                try #require(model.recordings.count == 1)
            } else {
                // Programmatic branch is integration/render evidence only, never input acceptance.
                try fixture.authorize(model)
                try await fixture.performEnabledAction(model, model.startRecording)
                try #require(model.current?.status == .recording)
                try await fixture.waitForSources(2, model: model)
                let first = try #require(model.current?.activeIntervalID)
                intervals.append(first)
                for session in ["one", "two"] { try fixture.append(session, turn: "interval-1-\(session)") }
                await fixture.read(model)
                try await fixture.performEnabledAction(model, model.pause)
                try #require(model.current?.status == .paused)
                await fixture.drain(model)
                try await fixture.performEnabledAction(model, model.resume)
                try #require(model.current?.status == .recording)
                try fixture.createSession("three")
                try await fixture.waitForSources(3, model: model)
                let second = try #require(model.current?.activeIntervalID)
                intervals.append(second)
                for session in ["one", "two", "three"] { try fixture.append(session, turn: "interval-2-\(session)") }
                await fixture.read(model)
                try await fixture.performEnabledAction(model, model.finish)
                try #require(model.current == nil)
                await fixture.drain(model)
            }
            await model.codex.stop()
            await fixture.drain(model)
            let recording = try #require(model.recordings.first)
            for (index, interval) in intervals.enumerated() {
                let rows = try await model.loadTelemetryReview(recordingID: recording.id, intervalID: interval)
                #expect(rows.count == (index == 0 ? 4 : 6))
                #expect(
                    rows.filter { $0.metadata.kind == "turnConfiguration" }.allSatisfy {
                        $0.metadata.configuredModel == "gpt-6-sol" && $0.metadata.configuredEffort == "high"
                    })
                #expect(
                    rows.filter { $0.metadata.kind == "responseUsage" }.allSatisfy {
                        $0.metadata.usage?.totalTokens == 1290
                    })
            }
            print(
                "C4 automatic hosted checks complete. Keyboard/VoiceOver acceptance must be reported from actual input separately."
            )
            #expect(await model.shutdown())
            await fixture.cleanup()
        } catch {
            _ = await model.shutdown()
            await fixture.cleanup()
            throw error
        }
    }
}
