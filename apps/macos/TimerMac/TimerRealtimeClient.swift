import Foundation

/// Owns the realtime connection so socket state never crosses its actor boundary.
actor TimerRealtimeClient {
    nonisolated let events: AsyncStream<TimerRealtimeClientEvent>

    private let eventContinuation: AsyncStream<TimerRealtimeClientEvent>.Continuation
    private let urlSession: URLSession
    private var connectionGeneration = 0
    private var isConnected = false
    private var pendingCommands: [TimerAction] = []
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
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        eventContinuation.finish()
    }

    func connect(socketURL: URL, accessToken: String) {
        connectionGeneration += 1
        let generation = connectionGeneration

        cancelCurrentConnection()
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
        pendingCommands.append(contentsOf: commands)
        schedulePendingCommandFlush()
    }

    func shutdown() {
        connectionGeneration += 1
        cancelCurrentConnection()
        eventContinuation.finish()
    }

    private func cancelCurrentConnection() {
        isConnected = false
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
                isConnected = true
                eventContinuation.yield(.connectionStateChanged(.connected))
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
            } catch is CancellationError {
                socket.cancel(with: .goingAway, reason: nil)
                return
            } catch {
                if !Task.isCancelled, generation == connectionGeneration {
                    isConnected = false
                    eventContinuation.yield(.connectionStateChanged(.reconnecting))
                    eventContinuation.yield(
                        .connectionFailed(error.localizedDescription)
                    )
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

        eventContinuation.yield(.stateReceived(envelope.data))
    }

    private func schedulePendingCommandFlush() {
        guard
            isConnected,
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
            let action = pendingCommands.first
        {
            do {
                let data = try JSONEncoder().encode(
                    RealtimeCommandEnvelope(action: action)
                )
                guard let message = String(data: data, encoding: .utf8) else {
                    return
                }

                try await socket.send(.string(message))

                guard isCurrentConnection(socket, generation: generation) else {
                    return
                }

                pendingCommands.removeFirst()
            } catch is CancellationError {
                return
            } catch {
                guard isCurrentConnection(socket, generation: generation) else {
                    return
                }

                eventContinuation.yield(.connectionStateChanged(.reconnecting))
                eventContinuation.yield(.commandQueued)
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
