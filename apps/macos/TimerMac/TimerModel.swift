import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class TimerModel {
    private(set) var displayElapsedMilliseconds = 0.0
    private(set) var isRunning = false
    private(set) var connectionState = ConnectionState.disconnected
    private(set) var latestRevision: Int?
    private(set) var pendingCommandCount = 0
    private(set) var unconfirmedCommandCount = 0
    private(set) var errorMessage: String?
    private(set) var apiBaseURL: String
    private(set) var accessToken: String

    @ObservationIgnored private let settingsStore: SettingsStore
    @ObservationIgnored private let keychainStore: KeychainStore
    @ObservationIgnored private let realtimeClient: TimerRealtimeClient
    @ObservationIgnored private let clock: TimerClock
    @ObservationIgnored private var baselineElapsedMilliseconds = 0.0
    @ObservationIgnored private var baselineSystemUptime: TimeInterval
    @ObservationIgnored private var realtimeEventsTask: Task<Void, Never>?
    @ObservationIgnored private var realtimeOperationTask: Task<Void, Never>?
    @ObservationIgnored private var tickerTask: Task<Void, Never>?
    @ObservationIgnored private var wakeTask: Task<Void, Never>?
    @ObservationIgnored private var sleepTask: Task<Void, Never>?

    init(
        settingsStore: SettingsStore = SettingsStore(),
        keychainStore: KeychainStore? = nil,
        realtimeClient: TimerRealtimeClient = TimerRealtimeClient(),
        clock: TimerClock = .live
    ) {
        self.settingsStore = settingsStore
        self.keychainStore = keychainStore ?? KeychainStore(scope: settingsStore.launchAPIBaseURL)
        self.realtimeClient = realtimeClient
        self.clock = clock
        baselineSystemUptime = clock.systemUptime()
        apiBaseURL = settingsStore.apiBaseURL
        accessToken = self.keychainStore.readToken()

        startLifecycle()
    }

    isolated deinit {
        realtimeEventsTask?.cancel()
        realtimeOperationTask?.cancel()
        tickerTask?.cancel()
        wakeTask?.cancel()
        sleepTask?.cancel()

        let realtimeClient = realtimeClient
        Task {
            await realtimeClient.shutdown()
        }
    }

    var minuteProgress: Double {
        projectedElapsedMilliseconds.truncatingRemainder(dividingBy: 60_000) / 60_000
    }

    var syncStatus: ConnectionState {
        connectionState == .connected && unconfirmedCommandCount > 0 ? .syncError : connectionState
    }

    var diagnosticEndpoint: String {
        TimerProjection.diagnosticEndpoint(from: apiBaseURL)
    }

    var saveStatus: String {
        if unconfirmedCommandCount > 0 {
            return "\(unconfirmedCommandCount) action(s) unconfirmed · not automatically retried"
        }
        if pendingCommandCount > 0 {
            return "\(pendingCommandCount) local action(s) awaiting server confirmation"
        }
        if let latestRevision {
            return "Last server-confirmed snapshot: revision \(latestRevision)"
        }
        return "Local timer · no server-confirmed snapshot yet"
    }

    // The ring samples this at animation cadence without publishing model updates.
    private var projectedElapsedMilliseconds: Double {
        guard isRunning else {
            return displayElapsedMilliseconds
        }

        let uptimeDelta = max(0, clock.systemUptime() - baselineSystemUptime)
        return baselineElapsedMilliseconds + uptimeDelta * 1_000
    }

    var menuBarTitle: String {
        let clock = TimerFormatting.clock(milliseconds: displayElapsedMilliseconds)
        return isLaunchProfile && isProductionAPI ? "\(clock) · PROD" : clock
    }

    var isLaunchProfile: Bool { settingsStore.launchAPIBaseURL != nil }

    var isProductionAPI: Bool { URL(string: apiBaseURL)?.host == "api.wellspent.day" }

    var backendProfileLabel: String {
        isProductionAPI ? "PRODUCTION API — actions affect real data" : "API: \(diagnosticEndpoint)"
    }

    var accessibilityTimerLabel: String {
        TimerFormatting.accessibilityLabel(
            milliseconds: displayElapsedMilliseconds
        )
    }

    func startOrResume() {
        guard !isRunning else {
            enqueue([.start])
            return
        }

        baselineElapsedMilliseconds = displayElapsedMilliseconds
        baselineSystemUptime = clock.systemUptime()
        isRunning = true
        updateTicker()
        enqueue([.start])
    }

    func pause() {
        refreshProjectedElapsed()
        baselineElapsedMilliseconds = displayElapsedMilliseconds
        isRunning = false
        updateTicker()
        enqueue([.pause])
    }

    func reset() {
        baselineElapsedMilliseconds = 0
        baselineSystemUptime = clock.systemUptime()
        displayElapsedMilliseconds = 0
        updateTicker()
        enqueue([.reset])
    }

    func applySettings(apiBaseURL: String, accessToken: String) {
        let trimmedURL = apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)

        if isLaunchProfile && trimmedURL != self.apiBaseURL {
            errorMessage = "The launch profile owns this API URL. Quit and relaunch with dev:local or dev:prod-api."
            return
        }

        guard TimerProjection.webSocketURL(from: trimmedURL) != nil else {
            errorMessage = "Enter an HTTP, HTTPS, WS, or WSS API URL."
            return
        }

        do {
            try keychainStore.saveToken(trimmedToken)
            if self.apiBaseURL != trimmedURL || self.accessToken != trimmedToken {
                latestRevision = nil
            }
            self.apiBaseURL = trimmedURL
            self.accessToken = trimmedToken
            settingsStore.save(apiBaseURL: trimmedURL)
            errorMessage = nil
            reconnect()
        } catch {
            errorMessage = "The access token could not be saved: \(error.localizedDescription)"
        }
    }

    func reconnectManually() {
        reconnect()
    }

    func dismissError() {
        errorMessage = nil
    }

    private func startLifecycle() {
        guard
            realtimeEventsTask == nil,
            wakeTask == nil,
            sleepTask == nil
        else {
            return
        }

        let events = realtimeClient.events
        realtimeEventsTask = Task { @MainActor [weak self] in
            for await event in events {
                guard let self else {
                    return
                }

                handle(event: event)
            }
        }

        wakeTask = Task { @MainActor [weak self] in
            let notifications = NSWorkspace.shared.notificationCenter.notifications(
                named: NSWorkspace.didWakeNotification
            )

            for await _ in notifications {
                guard !Task.isCancelled else {
                    return
                }

                guard let self else {
                    return
                }

                reconnect()
            }
        }

        sleepTask = Task { @MainActor [weak self] in
            let notifications = NSWorkspace.shared.notificationCenter.notifications(
                named: NSWorkspace.willSleepNotification
            )

            for await _ in notifications {
                guard !Task.isCancelled else {
                    return
                }

                guard let self else {
                    return
                }

                suspendConnection()
            }
        }

        reconnect()
    }

    private func reconnect() {
        guard let socketURL = TimerProjection.webSocketURL(from: apiBaseURL) else {
            connectionState = .disconnected
            errorMessage = "The configured API URL is invalid."
            return
        }

        let accessToken = accessToken
        scheduleRealtimeOperation { realtimeClient in
            await realtimeClient.connect(
                socketURL: socketURL,
                accessToken: accessToken
            )
        }
    }

    private func suspendConnection() {
        scheduleRealtimeOperation { realtimeClient in
            await realtimeClient.suspend()
        }
    }

    func handle(event: TimerRealtimeClientEvent) {
        switch event {
        case .serverChanged:
            latestRevision = nil
        case .connectionStateChanged(let state):
            connectionState = state
            if state == .connected {
                errorMessage = nil
            }
        case .stateReceived(let state):
            apply(state: state)
        case .connectionFailed(let message):
            errorMessage = "Realtime sync is unavailable: \(message)"
        case .deliveryChanged(let pending, let unconfirmed):
            pendingCommandCount = pending
            unconfirmedCommandCount = unconfirmed
        }
    }

    private func apply(state: RealtimeTimerState) {
        if let latestRevision, state.revision < latestRevision {
            return
        }

        let projectedElapsed = TimerProjection.elapsedMilliseconds(
            for: state,
            now: clock.now()
        )
        latestRevision = state.revision
        baselineElapsedMilliseconds = projectedElapsed
        baselineSystemUptime = clock.systemUptime()
        displayElapsedMilliseconds = projectedElapsed
        isRunning = state.isRunning
        updateTicker()
    }

    private func refreshProjectedElapsed() {
        guard isRunning else {
            return
        }

        displayElapsedMilliseconds = projectedElapsedMilliseconds
    }

    private func updateTicker() {
        tickerTask?.cancel()
        tickerTask = nil

        guard isRunning else {
            return
        }

        tickerTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                self?.refreshProjectedElapsed()

                do {
                    try await Task.sleep(for: .milliseconds(250))
                } catch {
                    return
                }
            }
        }
    }

    private func enqueue(_ commands: [TimerAction]) {
        scheduleRealtimeOperation { realtimeClient in
            await realtimeClient.enqueue(commands)
        }
    }

    private func scheduleRealtimeOperation(
        _ operation: @escaping @Sendable (TimerRealtimeClient) async -> Void
    ) {
        let previousOperation = realtimeOperationTask
        let realtimeClient = realtimeClient

        realtimeOperationTask = Task {
            await previousOperation?.value

            guard !Task.isCancelled else {
                return
            }

            await operation(realtimeClient)
        }
    }
}
