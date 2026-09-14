// Bounded, read-only capability probe. No permission requests, content capture,
// event taps, application activation, network, or durable observation storage.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

@MainActor
final class WorkspaceProbe: NSObject {
    var notificationCounts: [String: Int] = [:]
    var activationWithBundleID = 0
    let names: [(NSNotification.Name, String)] = [
        (NSWorkspace.didActivateApplicationNotification, "appActivated"),
        (NSWorkspace.willSleepNotification, "willSleep"),
        (NSWorkspace.didWakeNotification, "didWake"),
        (NSWorkspace.screensDidSleepNotification, "screensSleep"),
        (NSWorkspace.screensDidWakeNotification, "screensWake"),
        (NSWorkspace.sessionDidResignActiveNotification, "sessionInactive"),
        (NSWorkspace.sessionDidBecomeActiveNotification, "sessionActive"),
    ]

    func start() {
        for (name, label) in names {
            notificationCounts[label] = 0
            NSWorkspace.shared.notificationCenter.addObserver(
                self, selector: #selector(received), name: name, object: nil)
        }
    }

    @objc private func received(_ notification: Notification) {
        guard let label = names.first(where: { $0.0 == notification.name })?.1 else { return }
        notificationCounts[label, default: 0] += 1
        if notification.name == NSWorkspace.didActivateApplicationNotification,
            let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
            application.bundleIdentifier != nil
        {
            activationWithBundleID += 1
        }
    }

    func stop() { NSWorkspace.shared.notificationCenter.removeObserver(self) }
}

@main
struct MacOSSignalProbe {
    @MainActor static func main() async throws {
        let duration = CommandLine.arguments.dropFirst().first.flatMap(Int.init) ?? 5
        guard (1...60).contains(duration) else {
            throw NSError(domain: "MacOSSignalProbe", code: 2)
        }
        NSApplication.shared.setActivationPolicy(.prohibited)
        let probe = WorkspaceProbe()
        probe.start()
        defer { probe.stop() }
        let foreground = NSWorkspace.shared.frontmostApplication
        guard let anyInput = CGEventType(rawValue: UInt32.max) else {
            throw NSError(domain: "MacOSSignalProbe", code: 1)
        }
        let idleStart = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
        let accessibilityGranted = AXIsProcessTrusted()
        let screenCaptureGranted = CGPreflightScreenCaptureAccess()
        try await Task.sleep(for: .seconds(duration))
        let idleEnd = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
        let result: [String: Any] = [
            "probeVersion": 1,
            "homeDirectoryUsesAppContainer": NSHomeDirectory().contains("/Library/Containers/"),
            "durationSeconds": duration,
            "foregroundApplicationAvailable": foreground != nil,
            "foregroundBundleIdentifierAvailable": foreground?.bundleIdentifier != nil,
            "foregroundPIDPositive": (foreground?.processIdentifier ?? 0) > 0,
            "idleSamplesFiniteAndNonnegative": idleStart.isFinite && idleEnd.isFinite && idleStart >= 0 && idleEnd >= 0,
            "idleChangedBetweenSamples": idleStart != idleEnd,
            "accessibilityTrustedForProbe": accessibilityGranted,
            "screenCaptureGrantedForProbe": screenCaptureGranted,
            "notificationCounts": probe.notificationCounts,
            "activationWithBundleID": probe.activationWithBundleID,
        ]
        let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
}
