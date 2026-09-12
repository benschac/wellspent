enum TimerRealtimeClientEvent: Sendable {
    case serverChanged
    case connectionStateChanged(ConnectionState)
    case stateReceived(RealtimeTimerState)
    case connectionFailed(String)
    case deliveryChanged(pending: Int, unconfirmed: Int)
}
