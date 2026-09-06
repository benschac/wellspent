struct RealtimeCommandEnvelope: Encodable, Sendable {
    let action: TimerAction

    private enum CodingKeys: String, CodingKey {
        case event
        case data
    }

    private enum DataCodingKeys: String, CodingKey {
        case action
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("timer.command", forKey: .event)

        var data = container.nestedContainer(
            keyedBy: DataCodingKeys.self,
            forKey: .data
        )
        try data.encode(action, forKey: .action)
    }
}
