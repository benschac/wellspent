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
    @ObservationIgnored private var baselineElapsedMilliseconds = 0.0
    @ObservationIgnored private var baselineSystemUptime = ProcessInfo.processInfo.systemUptime
    @ObservationIgnored private var connectionGeneration = 0
    @ObservationIgnored private var pendingCommands: [TimerAction] = []
    @ObservationIgnored private var connectionTask: Task<Void, Never>?
    @ObservationIgnored private var flushTask: Task<Void, Never>?
    @ObservationIgnored private var flushGeneration: Int?
    @ObservationIgnored private var tickerTask: Task<Void, Never>?
    @ObservationIgnored private var wakeTask: Task<Void, Never>?
    @ObservationIgnored private var sleepTask: Task<Void, Never>?
    @ObservationIgnored private var webSocketTask: URLSessionWebSocketTask?

    init(
        settingsStore: SettingsStore = SettingsStore(),
        keychainStore: KeychainStore = KeychainStore()
    ) {
        self.settingsStore = settingsStore
        self.keychainStore = keychainStore
        apiBaseURL = settingsStore.apiBaseURL
        selectedDurationMinutes = settingsStore.durationMinutes
        accessToken = keychainStore.readToken()

        startLifecycle()
    }

    isolated deinit {
        connectionTask?.cancel()
        flushTask?.cancel()
        tickerTask?.cancel()
        wakeTask?.cancel()
        sleepTask?.cancel()
        webSocketTask?.cancel(with: .goingAway, reason: nil)
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
        baselineSystemUptime = ProcessInfo.processInfo.systemUptime
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
        guard wakeTask == nil, sleepTask == nil else {
            return
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
        connectionGeneration += 1
        let generation = connectionGeneration

        connectionTask?.cancel()
        flushTask?.cancel()
        flushTask = nil
        flushGeneration = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil

        guard TimerProjection.webSocketURL(from: apiBaseURL) != nil else {
            connectionState = .disconnected
            errorMessage = "The configured API URL is invalid."
            return
        }

        connectionTask = Task { @MainActor [weak self] in
            await self?.runConnectionLoop(generation: generation)
        }
    }

    private func suspendConnection() {
        connectionGeneration += 1
        connectionTask?.cancel()
        connectionTask = nil
        flushTask?.cancel()
        flushTask = nil
        flushGeneration = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        connectionState = .disconnected
    }

    private func runConnectionLoop(generation: Int) async {
        var reconnectDelay = 1

        while !Task.isCancelled, generation == connectionGeneration {
            connectionState = reconnectDelay == 1 ? .connecting : .reconnecting

            guard let socketURL = TimerProjection.webSocketURL(from: apiBaseURL) else {
                connectionState = .disconnected
                return
            }

            var request = URLRequest(url: socketURL)
            if !accessToken.isEmpty {
                request.setValue(
                    "Bearer \(accessToken)",
                    forHTTPHeaderField: "Authorization"
                )
            }

            let socket = URLSession.shared.webSocketTask(with: request)
            webSocketTask = socket
            socket.resume()

            do {
                let initialMessage = try await socket.receive()
                guard
                    !Task.isCancelled,
                    isCurrentConnection(socket, generation: generation)
                else {
                    socket.cancel(with: .goingAway, reason: nil)
                    return
                }

                handle(message: initialMessage)
                connectionState = .connected
                errorMessage = nil
                reconnectDelay = 1
                schedulePendingCommandFlush()

                while !Task.isCancelled, generation == connectionGeneration {
                    let message = try await socket.receive()
                    guard
                        !Task.isCancelled,
                        isCurrentConnection(socket, generation: generation)
                    else {
                        break
                    }

                    handle(message: message)
                }
            } catch {
                if !Task.isCancelled, generation == connectionGeneration {
                    connectionState = .reconnecting
                    errorMessage = "Realtime sync is unavailable: \(error.localizedDescription)"
                }
            }

            socket.cancel(with: .goingAway, reason: nil)
            if webSocketTask === socket {
                webSocketTask = nil
            }

            guard !Task.isCancelled, generation == connectionGeneration else {
                return
            }

            do {
                try await Task.sleep(for: .seconds(reconnectDelay))
            } catch {
                return
            }
            reconnectDelay = min(reconnectDelay * 2, 30)
        }
    }

    private func handle(message: URLSessionWebSocketTask.Message) {
        let data: Data

        switch message {
        case .data(let messageData):
            data = messageData
        case .string(let text):
            data = Data(text.utf8)
        @unknown default:
            return
        }

        guard
            let envelope = try? JSONDecoder().decode(
                RealtimeStateEnvelope.self,
                from: data
            ), envelope.event == "timer.state"
        else {
            return
        }

        apply(state: envelope.data)
    }

    private func apply(state: RealtimeTimerState) {
        if let latestRevision, state.revision < latestRevision {
            return
        }

        let projectedElapsed = TimerProjection.elapsedMilliseconds(
            for: state,
            now: .now
        )
        latestRevision = state.revision
        baselineElapsedMilliseconds = projectedElapsed
        baselineSystemUptime = ProcessInfo.processInfo.systemUptime
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
            ProcessInfo.processInfo.systemUptime - baselineSystemUptime
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
        pendingCommands.append(contentsOf: commands)

        guard connectionState == .connected else {
            return
        }

        schedulePendingCommandFlush()
    }

    private func schedulePendingCommandFlush() {
        guard
            connectionState == .connected,
            let socket = webSocketTask,
            !pendingCommands.isEmpty
        else {
            return
        }

        let generation = connectionGeneration
        guard flushGeneration != generation else {
            return
        }

        flushGeneration = generation
        flushTask = Task { @MainActor [weak self] in
            await self?.flushPendingCommands(
                generation: generation,
                socket: socket
            )

            guard let self, flushGeneration == generation else {
                return
            }

            flushTask = nil
            flushGeneration = nil
            schedulePendingCommandFlush()
        }
    }

    private func flushPendingCommands(
        generation: Int,
        socket: URLSessionWebSocketTask
    ) async {
        while connectionState == .connected,
            isCurrentConnection(socket, generation: generation),
            let action = pendingCommands.first
        {
            let message = """
                {"event":"timer.command","data":{"action":"\(action.rawValue)"}}
                """

            do {
                try await socket.send(.string(message))

                guard isCurrentConnection(socket, generation: generation) else {
                    return
                }

                pendingCommands.removeFirst()
            } catch {
                guard isCurrentConnection(socket, generation: generation) else {
                    return
                }

                connectionState = .reconnecting
                errorMessage = "A timer action is queued until sync reconnects."
                socket.cancel(with: .goingAway, reason: nil)
                return
            }
        }
    }

    private func isCurrentConnection(
        _ socket: URLSessionWebSocketTask,
        generation: Int
    ) -> Bool {
        generation == connectionGeneration && webSocketTask === socket
    }
}
