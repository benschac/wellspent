enum ConnectionState: Equatable, Sendable {
    case connecting
    case connected
    case reconnecting
    case disconnected
    case syncError

    var label: String {
        switch self {
        case .connecting:
            "Connecting"
        case .connected:
            "Connected"
        case .reconnecting:
            "Offline"
        case .disconnected:
            "Offline"
        case .syncError:
            "Sync error"
        }
    }

    var symbolName: String {
        switch self {
        case .connected:
            "checkmark.circle.fill"
        case .connecting, .reconnecting:
            "arrow.trianglehead.2.clockwise.rotate.90"
        case .disconnected, .syncError:
            "exclamationmark.triangle.fill"
        }
    }
}
