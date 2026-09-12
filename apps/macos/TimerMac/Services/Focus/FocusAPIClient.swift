import Foundation

struct FocusAPIClient: Sendable {
    typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
    private let transport: Transport
    private static let session = URLSession(
        configuration: .ephemeral, delegate: FocusHTTPDelegate(), delegateQueue: nil)

    init(transport: @escaping Transport = FocusAPIClient.send) {
        self.transport = transport
    }

    func request<Value: Decodable & Sendable>(
        _ type: Value.Type, connection: FocusConnection, path: String = "",
        method: String = "GET", body: Data? = nil
    ) async throws -> Value {
        let request = try connection.request(path: path, method: method, body: body)
        let (data, response) = try await transport(request)
        guard (200..<300).contains(response.statusCode) else { throw FocusAPIError.http(response.statusCode) }
        return try Self.decoder().decode(type, from: data)
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = try? Date(value, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) {
                return date
            }
            if let date = try? Date(value, strategy: .iso8601) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO timestamp")
        }
        return decoder
    }

    private static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw FocusAPIError.invalidResponse }
        return (data, response)
    }
}
