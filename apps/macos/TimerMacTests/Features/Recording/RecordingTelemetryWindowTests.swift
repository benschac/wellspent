import AppKit
import SwiftUI
import Testing

@testable import TimerMac

/// A hosted real view in a disposable test store. This is rendered proof, not an XCUITest or VoiceOver pass.
@MainActor
struct RecordingTelemetryWindowTests {
    @Test
    func syntheticTelemetryReviewWindow() async throws {
        let fixture = try await RecordingTelemetryFixture.make()
        defer { fixture.store.remove() }
        await fixture.repository.close()
        let model = RecordingModel(
            repository: SQLiteRecordingRepository(url: fixture.store.url), localScopeID: "local")
        do {
            model.load()
            await model.waitForIdle()
            model.selectedID = fixture.recordingID
            #expect(model.recordings.count == 2)
            #expect(model.selected?.intervals.count == 2)
            #expect(model.acceptingEvents == false)

            let host = NSHostingView(
                rootView: RecordingWindowView().environment(model)
                    .background(Color(nsColor: .windowBackgroundColor)).preferredColorScheme(.dark))
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 1200, height: 860),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "SYNTHETIC · Codex telemetry review · disposable store"
            window.isReleasedWhenClosed = false
            window.contentView = host
            window.center()
            window.makeKeyAndOrderFront(nil)
            defer { window.close() }
            for _ in 0..<100 {
                host.layoutSubtreeIfNeeded()
                if accessibilityText(in: host).contains("gpt-6-sol") { break }
                try await Task.sleep(for: .milliseconds(20))
            }
            if accessibilityText(in: host).contains("gpt-6-sol") {
                print("C4 telemetry same-process accessibility: populated configuration found")
            } else {
                print(
                    "C4 telemetry same-process accessibility tree unavailable; inspect rendered attachment separately")
            }
            try record(host, name: "C4-telemetry-review")
            model.selectedID = fixture.otherRecordingID
            try await Task.sleep(for: .milliseconds(250))
            host.layoutSubtreeIfNeeded()
            try record(host, name: "C4-telemetry-response-review")
            model.selectedID = fixture.recordingID
            try await Task.sleep(for: .milliseconds(250))
            host.layoutSubtreeIfNeeded()

            window.selectNextKeyView(nil)
            if let responder = window.firstResponder, responder !== window {
                print("C4 telemetry hosted keyboard traversal: \(type(of: responder))")
            } else {
                print("C4 telemetry hosted keyboard traversal unavailable")
            }
            print("C4 telemetry synthetic store: \(fixture.store.url.path)")
            print("C4 telemetry VoiceOver: manual check required; hosted render is not a spoken-navigation check")
            if let value = ProcessInfo.processInfo.environment["WELLSPENT_TELEMETRY_REVIEW_HOLD_SECONDS"],
                let requestedSeconds = Int(value), requestedSeconds > 0
            {
                let seconds = min(requestedSeconds, 600)
                print("C4 telemetry synthetic review open for \(seconds) seconds")
                // Async suspension leaves the main run loop free for actual keyboard and accessibility review.
                try await Task.sleep(for: .seconds(seconds))
            }
            #expect(await model.shutdown())
        } catch {
            _ = await model.shutdown()
            throw error
        }
    }

    private func accessibilityText(in root: any NSAccessibilityProtocol) -> String {
        var strings: [String] = []
        var visited: Set<ObjectIdentifier> = []
        func visit(_ element: any NSAccessibilityProtocol) {
            guard visited.insert(ObjectIdentifier(element)).inserted else { return }
            if let label = element.accessibilityLabel() { strings.append(label) }
            if let value = element.accessibilityValue() as? String { strings.append(value) }
            for child in element.accessibilityChildren() ?? [] {
                if let child = child as? any NSAccessibilityProtocol { visit(child) }
            }
        }
        visit(root)
        return strings.joined(separator: "\n")
    }

    private func record(_ view: NSView, name: String) throws {
        view.displayIfNeeded()
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        let screenshot = FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-\(UUID()).png")
        try png.write(to: screenshot)
        print("C4 telemetry hosted render: \(screenshot.path)")
        Attachment.record(png, named: "\(name).png")
    }
}
