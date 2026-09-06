enum TimerRealtimeClientEvent: Sendable {
    case connectionStateChanged(ConnectionState)
    case stateReceived(RealtimeTimerState)
    case connectionFailed(String)
    case commandQueued
}
