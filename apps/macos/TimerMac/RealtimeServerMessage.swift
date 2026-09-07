import Foundation

enum RealtimeServerMessage: Decodable, Sendable {
    case state(RealtimeTimerState)
    case acknowledgement(commandId: String, state: RealtimeTimerState)
    case failure(commandId: String?)
    case ignored

    private enum CodingKeys: String, CodingKey { case event, data }
    private enum DataKeys: String, CodingKey { case commandId, state }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .event) {
        case "timer.state":
            let state = try container.decode(RealtimeTimerState.self, forKey: .data)
            try Self.validate(state, decoder: decoder)
            self = .state(state)
        case "timer.command.ack":
            let data = try container.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
            let id = try data.decode(String.self, forKey: .commandId)
            guard !id.isEmpty, id.count <= 128 else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: decoder.codingPath, debugDescription: "Invalid command ID"))
            }
            let state = try data.decode(RealtimeTimerState.self, forKey: .state)
            try Self.validate(state, decoder: decoder)
            self = .acknowledgement(commandId: id, state: state)
        case "exception":
            let data = try container.nestedContainer(keyedBy: DataKeys.self, forKey: .data)
            self = .failure(commandId: try data.decodeIfPresent(String.self, forKey: .commandId))
        default:
            self = .ignored
        }
    }

    private static func validate(_ state: RealtimeTimerState, decoder: Decoder) throws {
        guard state.elapsedMilliseconds.isFinite, state.elapsedMilliseconds >= 0,
            state.revision >= 0,
            (try? Date(state.updatedAt, strategy: .iso8601)) != nil
        else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Invalid timer state"))
        }
    }
}
