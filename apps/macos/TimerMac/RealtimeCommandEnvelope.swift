import Foundation

struct RealtimeCommandEnvelope: Encodable, Sendable {
    let action: TimerAction
    let commandId: String

    init(action: TimerAction, commandId: String = UUID().uuidString) {
        self.action = action
        self.commandId = commandId
    }

    private enum CodingKeys: String, CodingKey {
        case event
        case data
    }

    private enum DataCodingKeys: String, CodingKey {
        case action
        case commandId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("timer.command", forKey: .event)

        var data = container.nestedContainer(
            keyedBy: DataCodingKeys.self,
            forKey: .data
        )
        try data.encode(action, forKey: .action)
        try data.encode(commandId, forKey: .commandId)
    }
}
