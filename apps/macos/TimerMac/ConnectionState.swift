enum ConnectionState: Equatable {
    case connecting
    case connected
    case reconnecting
    case disconnected

    var label: String {
        switch self {
        case .connecting:
            "Connecting"
        case .connected:
            "Synced"
        case .reconnecting:
            "Reconnecting"
        case .disconnected:
            "Offline"
        }
    }

    var symbolName: String {
        switch self {
        case .connected:
            "checkmark.circle.fill"
        case .connecting, .reconnecting:
            "arrow.trianglehead.2.clockwise.rotate.90"
        case .disconnected:
            "exclamationmark.triangle.fill"
        }
    }
}
