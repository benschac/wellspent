/// In-memory delivery bookkeeping, not an offline repository or replay log.
struct TimerCommandTracker: Sendable {
    private(set) var queued: [RealtimeCommandEnvelope] = []
    private(set) var awaiting: Set<String> = []
    private(set) var unconfirmed: Set<String> = []

    var pendingCount: Int { queued.count + awaiting.count }

    mutating func enqueue(_ commands: [TimerAction]) {
        queued.append(contentsOf: commands.map { RealtimeCommandEnvelope(action: $0) })
    }

    /// Remove before attempting a send: a failed send can still have committed.
    mutating func beginSend() -> RealtimeCommandEnvelope? {
        guard !queued.isEmpty else { return nil }
        let command = queued.removeFirst()
        awaiting.insert(command.commandId)
        return command
    }

    @discardableResult
    mutating func acknowledge(_ commandId: String) -> Bool {
        let wasAwaiting = awaiting.remove(commandId) != nil
        let wasUnconfirmed = unconfirmed.remove(commandId) != nil
        return wasAwaiting || wasUnconfirmed
    }

    mutating func markUnconfirmed(_ commandId: String) {
        if awaiting.remove(commandId) != nil {
            unconfirmed.insert(commandId)
        }
    }

    mutating func disconnect() {
        unconfirmed.formUnion(awaiting)
        awaiting.removeAll()
    }
}
