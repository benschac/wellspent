import AppKit

/// Bridges the deliberately narrow NSWorkspace signal into the recording repository.
/// It observes only while a committed foreground-only recording interval is authorized.
@MainActor
final class ForegroundApplicationMonitor: NSObject {
    private let recording: RecordingModel
    private let notificationCenter: NotificationCenter
    private let frontmostApplication: @MainActor () -> RecordingEvent.ApplicationIdentity?
    private var isObserving = false
    private var lastIdentity: RecordingEvent.ApplicationIdentity?
    private var lastIntervalID: UUID?

    init(
        recording: RecordingModel,
        notificationCenter: NotificationCenter = NSWorkspace.shared.notificationCenter,
        frontmostApplication: @escaping @MainActor () -> RecordingEvent.ApplicationIdentity? = {
            guard let application = NSWorkspace.shared.frontmostApplication else { return nil }
            return RecordingEvent.ApplicationIdentity(
                bundleIdentifier: application.bundleIdentifier, localizedName: application.localizedName,
                processIdentifier: application.processIdentifier)
        }
    ) {
        self.recording = recording
        self.notificationCenter = notificationCenter
        self.frontmostApplication = frontmostApplication
    }

    func synchronize() {
        guard recording.canCaptureForegroundApplications else {
            stopObserving()
            return
        }
        guard isObserving == false else { return }
        isObserving = true
        lastIdentity = nil
        lastIntervalID = nil
        notificationCenter.addObserver(
            self, selector: #selector(workspaceDidActivateApplication(_:)),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)
        notificationCenter.addObserver(
            self, selector: #selector(workspaceWillSleep(_:)), name: NSWorkspace.willSleepNotification, object: nil)
        notificationCenter.addObserver(
            self, selector: #selector(workspaceSessionDidResignActive(_:)),
            name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        recordTransition(frontmostApplication())
    }

    func stopObserving() {
        guard isObserving else { return }
        notificationCenter.removeObserver(self)
        isObserving = false
        lastIdentity = nil
        lastIntervalID = nil
    }

    func recordTransition(_ identity: RecordingEvent.ApplicationIdentity?) {
        guard recording.canCaptureForegroundApplications,
            let intervalID = recording.current?.activeIntervalID
        else { return }
        guard intervalID != lastIntervalID || identity != lastIdentity else { return }
        lastIntervalID = intervalID
        lastIdentity = identity
        recording.recordForegroundApplication(identity)
    }

    func suspendForSleep() {
        guard isObserving else { return }
        stopObserving()
        recording.suspendForLifecycle(reason: "Mac entered sleep")
    }

    func suspendForUnavailableSession() {
        guard isObserving else { return }
        stopObserving()
        recording.suspendForLifecycle(reason: "Mac session became unavailable")
    }

    @objc private func workspaceDidActivateApplication(_ notification: Notification) {
        let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        recordTransition(Self.identity(from: application))
    }

    @objc private func workspaceWillSleep(_ notification: Notification) { suspendForSleep() }

    @objc private func workspaceSessionDidResignActive(_ notification: Notification) {
        suspendForUnavailableSession()
    }

    private static func identity(from application: NSRunningApplication?) -> RecordingEvent.ApplicationIdentity? {
        guard let application else { return nil }
        return RecordingEvent.ApplicationIdentity(
            bundleIdentifier: application.bundleIdentifier, localizedName: application.localizedName,
            processIdentifier: application.processIdentifier)
    }
}
