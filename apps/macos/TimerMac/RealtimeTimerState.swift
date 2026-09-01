struct RealtimeTimerState: Decodable {
    let elapsedMilliseconds: Double
    let isRunning: Bool
    let revision: Int
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case elapsedMilliseconds = "elapsedMs"
        case isRunning
        case revision
        case updatedAt
    }
}
