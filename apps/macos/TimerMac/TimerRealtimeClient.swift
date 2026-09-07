import Foundation

/// Owns the realtime connection so socket state never crosses its actor boundary.
actor TimerRealtimeClient {
    nonisolated let events: AsyncStream<TimerRealtimeClientEvent>

    private let eventContinuation: AsyncStream<TimerRealtimeClientEvent>.Continuation
    private let urlSession: URLSession
    private var connectionGeneration = 0
    private var isConnected = false
    private var hasProtocolError = false
    private var commands = TimerCommandTracker()
    private var connectionScope: String?
    private var snapshotTimeoutTask: Task<Void, Never>?
    private var acknowledgementTasks: [String: Task<Void, Never>] = [:]
    private var connectionTask: Task<Void, Never>?
    private var flushTask: Task<Void, Never>?
    private var flushGeneration: Int?
    private var webSocketTask: URLSessionWebSocketTask?

    init(urlSession: URLSession = .shared) {
        let (events, continuation) = AsyncStream.makeStream(
            of: TimerRealtimeClientEvent.self,
            bufferingPolicy: .bufferingNewest(32)
        )
        self.events = events
        eventContinuation = continuation
        self.urlSession = urlSession
    }

    deinit {
        connectionTask?.cancel()
        flushTask?.cancel()
        snapshotTimeoutTask?.cancel()
        for task in acknowledgementTasks.values { task.cancel() }
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        eventContinuation.finish()
    }

    func connect(socketURL: URL, accessToken: String) {
        connectionGeneration += 1
        let generation = connectionGeneration

        cancelCurrentConnection()
        let scope = socketURL.absoluteString + "\n" + accessToken
        if let connectionScope, connectionScope != scope {
            // Never send one endpoint/account's local actions to another.
            commands = TimerCommandTracker()
            eventContinuation.yield(.serverChanged)
            publishDelivery()
        }
        connectionScope = scope
        connectionTask = Task { [weak self] in
            await self?.runConnectionLoop(
                socketURL: socketURL,
                accessToken: accessToken,
                generation: generation
            )
        }
    }

    func suspend() {
        connectionGeneration += 1
        cancelCurrentConnection()
        eventContinuation.yield(.connectionStateChanged(.disconnected))
    }

    func enqueue(_ commands: [TimerAction]) {
        self.commands.enqueue(commands)
        publishDelivery()
        schedulePendingCommandFlush()
    }

    func shutdown() {
        connectionGeneration += 1
        cancelCurrentConnection()
        eventContinuation.finish()
    }

    private func cancelCurrentConnection() {
        isConnected = false
        markAttemptedCommandsUnconfirmed()
        snapshotTimeoutTask?.cancel()
        snapshotTimeoutTask = nil
        connectionTask?.cancel()
        connectionTask = nil
        flushTask?.cancel()
        flushTask = nil
        flushGeneration = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
    }

    private func runConnectionLoop(
        socketURL: URL,
        accessToken: String,
        generation: Int
    ) async {
        var reconnectDelay = 1

        while !Task.isCancelled, generation == connectionGeneration {
            isConnected = false
            hasProtocolError = false
            eventContinuation.yield(
                .connectionStateChanged(
                    reconnectDelay == 1 ? .connecting : .reconnecting
                )
            )

            var request = URLRequest(url: socketURL)
            if !accessToken.isEmpty {
                request.setValue(
                    "Bearer \(accessToken)",
                    forHTTPHeaderField: "Authorization"
                )
            }

            let socket = urlSession.webSocketTask(with: request)
            webSocketTask = socket
            socket.resume()
            snapshotTimeoutTask = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(10)) } catch { return }
                await self?.snapshotTimedOut(socket: socket, generation: generation)
            }

            do {
                while !Task.isCancelled, generation == connectionGeneration {
                    let message = try await socket.receive()
                    guard
                        !Task.isCancelled,
                        isCurrentConnection(socket, generation: generation)
                    else {
                        break
                    }

                    if handle(message: message), !isConnected {
                        isConnected = true
                        hasProtocolError = false
                        snapshotTimeoutTask?.cancel()
                        snapshotTimeoutTask = nil
                        eventContinuation.yield(.connectionStateChanged(.connected))
                        reconnectDelay = 1
                        schedulePendingCommandFlush()
                    }
                }
            } catch is CancellationError {
                socket.cancel(with: .goingAway, reason: nil)
                return
            } catch {
                if !Task.isCancelled, generation == connectionGeneration {
                    isConnected = false
                    markAttemptedCommandsUnconfirmed()
                    eventContinuation.yield(
                        .connectionStateChanged(
                            socket.closeCode == .internalServerError || hasProtocolError ? .syncError : .reconnecting))
                    if !hasProtocolError {
                        eventContinuation.yield(
                            .connectionFailed(
                                socket.closeCode == .internalServerError
                                    ? "The server could not load timer storage. Reconnecting."
                                    : "Connection lost. Local timer changes are not yet confirmed.")
                        )
                    }
                }
            }

            socket.cancel(with: .goingAway, reason: nil)
            if webSocketTask === socket {
                snapshotTimeoutTask?.cancel()
                snapshotTimeoutTask = nil
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

    /// Only a validated timer snapshot completes the connection handshake.
    @discardableResult
    func handle(message: URLSessionWebSocketTask.Message) -> Bool {
        let data: Data

        switch message {
        case .data(let messageData):
            data = messageData
        case .string(let text):
            data = Data(text.utf8)
        @unknown default:
            return false
        }

        guard
            let envelope = try? JSONDecoder().decode(
                RealtimeServerMessage.self,
                from: data
            )
        else {
            reportSyncError("The server returned an invalid timer message. Reconnect to retry.", protocolError: true)
            return false
        }

        switch envelope {
        case .state(let state):
            eventContinuation.yield(.stateReceived(state))
            return true
        case .acknowledgement(let commandId, let state):
            guard commands.acknowledge(commandId) else { return false }
            acknowledgementTasks.removeValue(forKey: commandId)?.cancel()
            eventContinuation.yield(.stateReceived(state))
            publishDelivery()
            if isConnected, !hasProtocolError, commands.unconfirmed.isEmpty {
                eventContinuation.yield(.connectionStateChanged(.connected))
            }
        case .failure(let commandId):
            if let commandId {
                commands.markUnconfirmed(commandId)
                acknowledgementTasks.removeValue(forKey: commandId)?.cancel()
            } else {
                markAttemptedCommandsUnconfirmed()
            }
            publishDelivery()
            reportSyncError(
                "A timer action could not be confirmed by the server. It will not be retried automatically.")
        case .ignored:
            break
        }
        return false
    }

    private func publishDelivery() {
        eventContinuation.yield(
            .deliveryChanged(pending: commands.pendingCount, unconfirmed: commands.unconfirmed.count))
    }

    private func markAttemptedCommandsUnconfirmed() {
        commands.disconnect()
        for task in acknowledgementTasks.values { task.cancel() }
        acknowledgementTasks.removeAll()
        publishDelivery()
    }

    private func reportSyncError(_ message: String, protocolError: Bool = false) {
        hasProtocolError = hasProtocolError || protocolError
        eventContinuation.yield(.connectionStateChanged(.syncError))
        eventContinuation.yield(.connectionFailed(message))
    }

    private func snapshotTimedOut(socket: URLSessionWebSocketTask, generation: Int) {
        guard isCurrentConnection(socket, generation: generation), !isConnected else { return }
        reportSyncError("No valid timer snapshot arrived. Check the API address; reconnecting.", protocolError: true)
        socket.cancel(with: .goingAway, reason: nil)
    }

    private func acknowledgementTimedOut(_ commandId: String) {
        guard commands.awaiting.contains(commandId) else { return }
        commands.markUnconfirmed(commandId)
        acknowledgementTasks.removeValue(forKey: commandId)
        publishDelivery()
        reportSyncError(
            "A timer save was not acknowledged. Its outcome is unknown; it will not be retried automatically.")
    }

    private func schedulePendingCommandFlush() {
        guard
            isConnected,
            let socket = webSocketTask,
            !commands.queued.isEmpty
        else {
            return
        }

        let generation = connectionGeneration
        guard flushGeneration != generation else {
            return
        }

        flushGeneration = generation
        flushTask = Task { [weak self] in
            guard let self else {
                return
            }

            await self.flushPendingCommands(
                generation: generation,
                socket: socket
            )
            await self.finishPendingCommandFlush(generation: generation)
        }
    }

    private func finishPendingCommandFlush(generation: Int) {
        guard flushGeneration == generation else {
            return
        }

        flushTask = nil
        flushGeneration = nil
        schedulePendingCommandFlush()
    }

    private func flushPendingCommands(
        generation: Int,
        socket: URLSessionWebSocketTask
    ) async {
        while isCurrentConnection(socket, generation: generation),
            let command = commands.beginSend()
        {
            publishDelivery()
            acknowledgementTasks[command.commandId] = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
                await self?.acknowledgementTimedOut(command.commandId)
            }
            do {
                let data = try JSONEncoder().encode(
                    command
                )
                guard let message = String(data: data, encoding: .utf8) else {
                    return
                }

                try await socket.send(.string(message))

                guard isCurrentConnection(socket, generation: generation) else {
                    return
                }
            } catch is CancellationError {
                return
            } catch {
                guard isCurrentConnection(socket, generation: generation) else {
                    return
                }

                eventContinuation.yield(.connectionStateChanged(.reconnecting))
                markAttemptedCommandsUnconfirmed()
                eventContinuation.yield(
                    .connectionFailed(
                        "Connection lost during a timer action. Its save is unconfirmed and will not be retried automatically."
                    ))
                isConnected = false
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
