import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class TimerModel {
    static let durationOptions = [5, 15, 25, 45, 60]

    private(set) var displayElapsedMilliseconds = 0.0
    private(set) var isRunning = false
    private(set) var connectionState = ConnectionState.disconnected
    private(set) var latestRevision: Int?
    private(set) var errorMessage: String?
    private(set) var apiBaseURL: String
    private(set) var accessToken: String

    var selectedDurationMinutes: Int {
        didSet {
            settingsStore.save(
                apiBaseURL: apiBaseURL,
                durationMinutes: selectedDurationMinutes
            )
        }
    }

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
        keychainStore: KeychainStore = KeychainStore(),
        realtimeClient: TimerRealtimeClient = TimerRealtimeClient(),
        clock: TimerClock = .live
    ) {
        self.settingsStore = settingsStore
        self.keychainStore = keychainStore
        self.realtimeClient = realtimeClient
        self.clock = clock
        baselineSystemUptime = clock.systemUptime()
        apiBaseURL = settingsStore.apiBaseURL
        selectedDurationMinutes = settingsStore.durationMinutes
        accessToken = keychainStore.readToken()

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

    var totalDurationMilliseconds: Double {
        Double(selectedDurationMinutes) * 60_000
    }

    var remainingMilliseconds: Double {
        max(0, totalDurationMilliseconds - displayElapsedMilliseconds)
    }

    var progress: Double {
        guard totalDurationMilliseconds > 0 else {
            return 0
        }

        return min(1, displayElapsedMilliseconds / totalDurationMilliseconds)
    }

    var isOvertime: Bool {
        displayElapsedMilliseconds >= totalDurationMilliseconds
    }

    var menuBarTitle: String {
        TimerFormatting.clock(milliseconds: remainingMilliseconds)
    }

    var accessibilityTimerLabel: String {
        TimerFormatting.accessibilityLabel(
            milliseconds: remainingMilliseconds,
            isComplete: isOvertime
        )
    }

    func startOrResume() {
        var commands: [TimerAction] = []

        if isOvertime {
            baselineElapsedMilliseconds = 0
            displayElapsedMilliseconds = 0
            commands.append(.reset)
        }

        baselineElapsedMilliseconds = displayElapsedMilliseconds
        baselineSystemUptime = clock.systemUptime()
        isRunning = true
        commands.append(.start)
        updateTicker()
        enqueue(commands)
    }

    func pause() {
        refreshProjectedElapsed()
        baselineElapsedMilliseconds = displayElapsedMilliseconds
        isRunning = false
        updateTicker()
        enqueue([.pause])
    }

    func stop() {
        baselineElapsedMilliseconds = 0
        displayElapsedMilliseconds = 0
        isRunning = false
        updateTicker()
        enqueue([.pause, .reset])
    }

    func applySettings(apiBaseURL: String, accessToken: String) {
        let trimmedURL = apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = accessToken.trimmingCharacters(in: .whitespacesAndNewlines)

        guard TimerProjection.webSocketURL(from: trimmedURL) != nil else {
            errorMessage = "Enter an HTTP, HTTPS, WS, or WSS API URL."
            return
        }

        do {
            try keychainStore.saveToken(trimmedToken)
            self.apiBaseURL = trimmedURL
            self.accessToken = trimmedToken
            settingsStore.save(
                apiBaseURL: trimmedURL,
                durationMinutes: selectedDurationMinutes
            )
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

    private func handle(event: TimerRealtimeClientEvent) {
        switch event {
        case .connectionStateChanged(let state):
            connectionState = state
            if state == .connected {
                errorMessage = nil
            }
        case .stateReceived(let state):
            apply(state: state)
        case .connectionFailed(let message):
            errorMessage = "Realtime sync is unavailable: \(message)"
        case .commandQueued:
            errorMessage = "A timer action is queued until sync reconnects."
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

        let uptimeDelta = max(
            0,
            clock.systemUptime() - baselineSystemUptime
        )
        displayElapsedMilliseconds = baselineElapsedMilliseconds + uptimeDelta * 1_000
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
