import AppKit
import Foundation
import Testing

@testable import TimerMac

@MainActor
struct ForegroundApplicationMonitorTests {
    private let clock = RecordingModelClockFixture()

    @Test
    func recordsInitialForegroundApplicationAndActivationTransitionsOnlyForLiveRecording() async throws {
        let store = RecordingModelRepositoryFixture()
        let model = RecordingModel(repository: store, stamp: clock.stamp)
        let editor = identity(name: "Editor", bundleID: "example.editor", processID: 101)
        let browser = identity(name: "Browser", bundleID: "example.browser", processID: 102)
        let monitor = ForegroundApplicationMonitor(
            recording: model, notificationCenter: .init(), frontmostApplication: { editor })
        model.load()
        await model.waitForIdle()

        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        monitor.synchronize()
        await model.waitForIdle()
        monitor.recordTransition(editor)
        monitor.recordTransition(browser)
        await model.waitForIdle()

        let recording = try #require(model.current)
        #expect(recording.capturesForegroundApplications)
        #expect(recording.events.map(\.kind) == [.start, .application, .application])
        #expect(recording.events.compactMap(\.applicationIdentity) == [editor, browser])
        #expect(recording.events[1].text.contains("Editor"))
        #expect(recording.events[1].text.contains("example.editor"))
        monitor.stopObserving()
    }

    @Test
    func sleepSuspendsCoverageAndResumeStartsASeparateExplicitInterval() async throws {
        let store = RecordingModelRepositoryFixture()
        let model = RecordingModel(repository: store, stamp: clock.stamp)
        let editor = identity(name: "Editor", bundleID: "example.editor", processID: 101)
        let notifications = NotificationCenter()
        let monitor = ForegroundApplicationMonitor(
            recording: model, notificationCenter: notifications, frontmostApplication: { editor })
        model.load()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        monitor.synchronize()
        await model.waitForIdle()

        notifications.post(name: NSWorkspace.willSleepNotification, object: nil)
        await model.waitForIdle()
        let suspended = try #require(model.current)
        #expect(suspended.status == .suspended)
        #expect(suspended.events.last?.kind == .suspend)
        #expect(suspended.events.last?.text.contains("explicit Resume required") == true)
        monitor.recordTransition(identity(name: "Terminal", bundleID: "example.terminal", processID: 103))
        await model.waitForIdle()
        #expect(model.current?.events.map(\.kind) == [.start, .application, .suspend])

        model.resume()
        await model.waitForIdle()
        monitor.synchronize()
        await model.waitForIdle()
        let resumed = try #require(model.current)
        #expect(resumed.status == .recording)
        #expect(resumed.intervals.count == 2)
        #expect(resumed.events.map(\.kind) == [.start, .application, .suspend, .resume, .application])
        monitor.stopObserving()
    }

    @Test
    func unavailableMacSessionStopsObservationAndRequiresManualResume() async throws {
        let store = RecordingModelRepositoryFixture()
        let model = RecordingModel(repository: store, stamp: clock.stamp)
        let notifications = NotificationCenter()
        let monitor = ForegroundApplicationMonitor(
            recording: model, notificationCenter: notifications,
            frontmostApplication: { self.identity(name: "Editor", bundleID: "example.editor", processID: 101) })
        model.load()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        monitor.synchronize()
        await model.waitForIdle()

        notifications.post(name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        await model.waitForIdle()
        #expect(model.current?.status == .suspended)
        #expect(model.current?.events.last?.text.contains("session became unavailable") == true)
        notifications.post(name: NSWorkspace.willSleepNotification, object: nil)
        await model.waitForIdle()
        #expect(model.current?.events.filter { $0.kind == .suspend }.count == 1)
        monitor.stopObserving()
    }

    @Test
    func pausedOrSampleRecordingNeverAcceptsForegroundTransitions() async throws {
        let store = RecordingModelRepositoryFixture()
        let model = RecordingModel(repository: store, stamp: clock.stamp)
        let editor = identity(name: "Editor", bundleID: "example.editor", processID: 101)
        let monitor = ForegroundApplicationMonitor(
            recording: model, notificationCenter: .init(), frontmostApplication: { editor })
        model.load()
        await model.waitForIdle()
        model.startRecording()
        await model.waitForIdle()
        monitor.synchronize()
        monitor.recordTransition(editor)
        await model.waitForIdle()
        #expect(model.current?.events.map(\.kind) == [.start])

        model.finish()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        monitor.synchronize()
        await model.waitForIdle()
        model.pause()
        await model.waitForIdle()
        monitor.synchronize()
        monitor.recordTransition(identity(name: "Browser", bundleID: "example.browser", processID: 102))
        await model.waitForIdle()
        #expect(model.current?.events.map(\.kind) == [.start, .application, .pause])
        monitor.stopObserving()
    }

    @Test(arguments: [false, true])
    func transitionsDuringSaveKeepReceiptOrderAndTimestamps(failSave: Bool) async throws {
        let store = RecordingModelRepositoryFixture()
        let model = RecordingModel(repository: store, stamp: clock.stamp)
        let editor = identity(name: "Editor", bundleID: "example.editor", processID: 101)
        let browser = identity(name: "Browser", bundleID: "example.browser", processID: 102)
        let terminal = identity(name: "Terminal", bundleID: "example.terminal", processID: 103)
        let monitor = ForegroundApplicationMonitor(
            recording: model, notificationCenter: .init(), frontmostApplication: { editor })
        model.captureStateDidChange = { monitor.synchronize() }
        defer {
            model.captureStateDidChange = nil
            monitor.stopObserving()
        }
        model.load()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        await model.waitForIdle()

        await store.holdNextCommit()
        if failSave { await store.failNext() }
        model.addNoteSample()
        await store.waitUntilCommitHeld()
        monitor.synchronize()
        monitor.recordTransition(browser)
        let browserReceipt = clock.stamp()
        monitor.recordTransition(terminal)
        let terminalReceipt = clock.stamp()
        monitor.recordTransition(terminal)
        #expect(model.canCaptureForegroundApplications)
        await store.releaseCommit()
        await model.waitForIdle()

        if failSave {
            #expect(!model.canCaptureForegroundApplications)
            model.retry()
            await model.waitForIdle()
        }
        let events = try #require(model.current).events
        #expect(events.compactMap(\.applicationIdentity) == [editor, browser, terminal])
        let browserEvent = try #require(events.first { $0.applicationIdentity == browser })
        let terminalEvent = try #require(events.first { $0.applicationIdentity == terminal })
        #expect(browserEvent.stamp.uptime == browserReceipt.uptime - 1)
        #expect(terminalEvent.stamp.uptime == terminalReceipt.uptime - 1)
        #expect(model.current?.status == (failSave ? .interrupted : .recording))
    }

    @Test(arguments: [false, true], [false, true])
    func lifecycleDuringSaveRevokesIntakeAndPersistsBoundary(sessionUnavailable: Bool, failSave: Bool) async throws {
        let store = RecordingModelRepositoryFixture()
        let model = RecordingModel(repository: store, stamp: clock.stamp)
        let editor = identity(name: "Editor", bundleID: "example.editor", processID: 101)
        let browser = identity(name: "Browser", bundleID: "example.browser", processID: 102)
        let notifications = NotificationCenter()
        let monitor = ForegroundApplicationMonitor(
            recording: model, notificationCenter: notifications, frontmostApplication: { editor })
        model.captureStateDidChange = { monitor.synchronize() }
        defer {
            model.captureStateDidChange = nil
            monitor.stopObserving()
        }
        model.load()
        await model.waitForIdle()
        model.startForegroundApplicationRecording()
        await model.waitForIdle()
        await model.waitForIdle()

        await store.holdNextCommit()
        if failSave { await store.failNext() }
        monitor.recordTransition(browser)
        await store.waitUntilCommitHeld()
        monitor.recordTransition(editor)
        notifications.post(
            name: sessionUnavailable
                ? NSWorkspace.sessionDidResignActiveNotification : NSWorkspace.willSleepNotification,
            object: nil)
        let boundaryReceipt = clock.stamp()
        #expect(!model.acceptingEvents)
        #expect(!model.canCaptureForegroundApplications)
        monitor.synchronize()
        monitor.recordTransition(browser)
        await store.releaseCommit()
        await model.waitForIdle()
        if failSave {
            model.retry()
            await model.waitForIdle()
        }

        let suspended = try #require(model.current)
        #expect(suspended.status == .suspended)
        #expect(suspended.events.map(\.kind) == [.start, .application, .application, .application, .suspend])
        #expect(suspended.events.compactMap(\.applicationIdentity) == [editor, browser, editor])
        #expect(suspended.events.last?.stamp.uptime == boundaryReceipt.uptime - 1)
        #expect(!model.canCaptureForegroundApplications)
        monitor.synchronize()
        await model.waitForIdle()
        #expect(model.current?.events.count == suspended.events.count)

        model.resume()
        await model.waitForIdle()
        await model.waitForIdle()
        #expect(model.current?.intervals.count == 2)
        #expect(model.current?.events.suffix(2).map(\.kind) == [.resume, .application])
    }

    private func identity(name: String, bundleID: String, processID: Int32) -> RecordingEvent.ApplicationIdentity {
        .init(bundleIdentifier: bundleID, localizedName: name, processIdentifier: processID)
    }
}
