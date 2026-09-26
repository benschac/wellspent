import AppKit
import SwiftUI
import Testing

@testable import TimerMac

/// Hosted rendering is separate from a user's running app, input devices and live capture.
@MainActor
struct RecordingTaskWindowTests {
    @Test
    func isolatedWorkspaceRendersTaskSelectionCorrectionAndHistoryAtBothWidths() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let model = RecordingModel(
            repository: SQLiteRecordingRepository(url: fixture.url), stamp: RecordingModelClockFixture().stamp)
        model.load()
        await model.waitForIdle()
        for title in ["Review capture", "Fix persistence"] {
            model.tasks.createRecordingTask(title: title)
            await model.waitForIdle()
        }
        let first = try #require(model.tasks.taskAttribution.tasks.first { $0.title == "Review capture" })
        let second = try #require(model.tasks.taskAttribution.tasks.first { $0.title == "Fix persistence" })
        model.startRecording()
        await model.waitForIdle()
        model.tasks.selectRecordingTask(first.id)
        await model.waitForIdle()
        model.addApplicationSample()
        await model.waitForIdle()
        model.tasks.selectRecordingTask(second.id)
        await model.waitForIdle()
        model.addAgentSample()
        await model.waitForIdle()
        let event = try #require(model.current?.events.first { $0.kind == .agentCompletion })
        model.tasks.correctRecordingTask(event, assignment: .task(first.id))
        await model.waitForIdle()
        let original = try #require(model.tasks.taskAttribution.head(eventID: event.id))
        model.tasks.undoRecordingTask(original)
        await model.waitForIdle()
        #expect(model.tasks.taskTitle(for: event) == "Unassigned")
        #expect(model.tasks.activeTaskTitle == "Fix persistence")
        #expect(model.acceptingEvents)

        let host = NSHostingView(
            rootView: RecordingWindowView().environment(model)
                .background(Color(nsColor: .windowBackgroundColor)).preferredColorScheme(.dark))
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 860),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        defer { window.close() }
        for size in [CGSize(width: 1200, height: 860), CGSize(width: 980, height: 700)] {
            window.setContentSize(size)
            host.layoutSubtreeIfNeeded()
            try record(host, name: "C4-task-workspace-\(Int(size.width))")
        }

        // The actual per-evidence controls also render independently of timeline scrolling.
        let review = NSHostingView(
            rootView: RecordingAttributionView(event: event).environment(model).padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(Color(nsColor: .windowBackgroundColor)).preferredColorScheme(.dark))
        window.contentView = review
        window.setContentSize(CGSize(width: 700, height: 360))
        review.layoutSubtreeIfNeeded()
        let elements = accessibilityElements(in: review)
        if let disclosure = elements.first(where: { $0.accessibilityRole() == .disclosureTriangle }) {
            #expect(disclosure.accessibilityPerformPress())
            await Task.yield()
            review.layoutSubtreeIfNeeded()
            print("C4 isolated native disclosure: pressed assignment history")
        } else {
            print("C4 isolated native disclosure unavailable; screenshot shows collapsed history")
        }
        try record(review, name: "C4-agent-assignment-history")
        window.makeKeyAndOrderFront(nil)
        window.selectNextKeyView(nil)
        if let responder = window.firstResponder, responder !== window {
            print("C4 isolated native keyboard traversal: \(type(of: responder))")
        } else {
            print("C4 isolated native keyboard traversal unavailable")
        }
        #expect(model.recordings.count == 1, "Rendering cannot authorize another recording")
        #expect(model.tasks.taskAttribution.operations.count == 2)
        if let value = ProcessInfo.processInfo.environment["WELLSPENT_TASK_REVIEW_HOLD_SECONDS"],
            let requestedSeconds = Int(value), requestedSeconds > 0
        {
            window.title = "SYNTHETIC · Task attribution · disposable store"
            window.contentView = host
            window.setContentSize(CGSize(width: 1200, height: 860))
            window.center()
            window.makeKeyAndOrderFront(nil)
            print("Task attribution synthetic store: \(fixture.url.path)")
            // Keep the main run loop available for input against only this disposable fixture.
            try await Task.sleep(for: .seconds(min(requestedSeconds, 600)))
        }
        model.finish()
        await model.waitForIdle()
        #expect(await model.shutdown())
    }

    private func accessibilityElements(in root: any NSAccessibilityProtocol) -> [any NSAccessibilityProtocol] {
        var found: [any NSAccessibilityProtocol] = []
        var visited: Set<ObjectIdentifier> = []
        func visit(_ element: any NSAccessibilityProtocol) {
            guard visited.insert(ObjectIdentifier(element)).inserted else { return }
            found.append(element)
            for child in element.accessibilityChildren() ?? [] {
                if let child = child as? any NSAccessibilityProtocol { visit(child) }
            }
        }
        visit(root)
        return found
    }

    private func record(_ view: NSView, name: String) throws {
        view.displayIfNeeded()
        let bitmap = try #require(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        let screenshot = FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-\(UUID()).png")
        try png.write(to: screenshot)
        print("C4 isolated native render: \(screenshot.path)")
        Attachment.record(png, named: "\(name).png")
    }
}
