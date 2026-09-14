import CoreFoundation
import Foundation

/// The native app only initiates bounded requests to the explicitly paired loopback helper.
struct LocalCodexTransport: Sendable {
    enum Failure: Error, Equatable {
        case invalidEndpoint, invalidKey, oversizedResponse, invalidResponse
        case http(Int)
    }

    struct Status: Codable, Equatable, Sendable {
        let pending: Int
        let quarantined: Int
        let unassociated: Int
        let reasons: [String: Int]
    }

    struct PollResponse: Codable, Sendable {
        let packet: CodexIntakeContract.Packet?
        let status: Status
    }

    private struct FreshRequest: Encodable {
        let version = 1
        let bindingID: String
        let nonce = UUID().uuidString.lowercased()
        let issuedAt = CodexIntakeContract.timestamp(Date())
    }

    private struct Rejection: Encodable {
        let version = 1
        let bindingID: String
        let eventID: String
        let bodyDigest: String
        let reason: String
        let nonce = UUID().uuidString.lowercased()
        let issuedAt = CodexIntakeContract.timestamp(Date())
    }

    private let endpoint: URL
    static let responseLimit = 32 * 1024

    init(endpoint: String) throws {
        guard endpoint.range(of: #"\Ahttp://127\.0\.0\.1:[1-9][0-9]{0,4}\z"#, options: .regularExpression) != nil,
            let url = URL(string: endpoint), let port = url.port, (1...65535).contains(port)
        else { throw Failure.invalidEndpoint }
        self.endpoint = url
    }

    func poll(bindingID: UUID, key: Data) async throws -> PollResponse {
        let data = try await send(
            signed(FreshRequest(bindingID: bindingID.uuidString.lowercased()), key: key, domain: "poll"),
            path: "/v1/poll")
        let fields = try object(data, keys: ["packet", "status"])
        guard let statusFields = fields["status"] as? [String: Any] else { throw Failure.invalidResponse }
        try validateStatus(statusFields)
        if !(fields["packet"] is NSNull) {
            guard let packet = fields["packet"] as? [String: Any], Set(packet.keys) == ["body", "mac"],
                let body = packet["body"] as? String, let mac = packet["mac"] as? String,
                let decodedBody = Data(base64Encoded: body), decodedBody.count <= 8192,
                decodedBody.base64EncodedString() == body,
                let decodedMAC = Data(base64Encoded: mac), decodedMAC.count == 32,
                decodedMAC.base64EncodedString() == mac,
                try JSONSerialization.data(withJSONObject: packet).count <= 16384
            else { throw Failure.invalidResponse }
        }
        return try JSONDecoder().decode(PollResponse.self, from: data)
    }

    func status(bindingID: UUID, key: Data) async throws -> Status {
        let data = try await send(
            signed(FreshRequest(bindingID: bindingID.uuidString.lowercased()), key: key, domain: "status"),
            path: "/v1/status")
        try validateStatus(object(data, keys: ["pending", "quarantined", "unassociated", "reasons"]))
        return try JSONDecoder().decode(Status.self, from: data)
    }

    func acknowledge(_ packet: CodexIntakeContract.Packet) async throws {
        try await accepted(send(packet, path: "/v1/ack"))
    }

    func reject(bindingID: UUID, eventID: UUID, bodyDigest: String, reason: String, key: Data) async throws {
        let request = Rejection(
            bindingID: bindingID.uuidString.lowercased(), eventID: eventID.uuidString.lowercased(),
            bodyDigest: bodyDigest, reason: reason)
        try await accepted(send(signed(request, key: key, domain: "reject"), path: "/v1/reject"))
    }

    private func signed<T: Encodable>(_ body: T, key: Data, domain: String) throws -> CodexIntakeContract.Packet {
        guard key.count == 32 else { throw Failure.invalidKey }
        return CodexIntakeContract.sign(try JSONEncoder().encode(body), key: key, domain: domain)
    }

    private func accepted(_ data: Data) throws {
        let fields = try object(data, keys: ["ok"])
        guard let ok = fields["ok"] as? NSNumber, CFGetTypeID(ok) == CFBooleanGetTypeID(), ok.boolValue else {
            throw Failure.invalidResponse
        }
    }

    private func object(_ data: Data, keys: Set<String>) throws -> [String: Any] {
        guard let fields = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(fields.keys) == keys
        else { throw Failure.invalidResponse }
        return fields
    }

    private func validateStatus(_ fields: [String: Any]) throws {
        guard Set(fields.keys) == ["pending", "quarantined", "unassociated", "reasons"],
            let reasons = fields["reasons"] as? [String: Any], reasons.count <= 32
        else { throw Failure.invalidResponse }
        for value in [fields["pending"], fields["quarantined"], fields["unassociated"]]
            + reasons.values.map(Optional.some)
        {
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                number.doubleValue >= 0, number.doubleValue <= Double(Int32.max),
                number.doubleValue.rounded(.towardZero) == number.doubleValue
            else { throw Failure.invalidResponse }
        }
        let allowedReasons: Set<String> = [
            "invalidPacket", "untrustedSender", "invalidAssociation", "expiredBinding", "outsideInterval",
            "interruptedInterval", "identityConflict", "unassociated", "missing_identity", "unsupported_hook",
            "self_capture", "queue_full", "pairing_unavailable",
        ]
        guard Set(reasons.keys).isSubset(of: allowedReasons) else {
            throw Failure.invalidResponse
        }
    }

    private func send(_ packet: CodexIntakeContract.Packet, path: String) async throws -> Data {
        try Task.checkCancellation()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 15
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let url = endpoint.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.httpBody = try JSONEncoder().encode(packet)
        guard let requestBody = request.httpBody, requestBody.count <= 16384 else { throw Failure.invalidResponse }
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse, response.url == url else { throw Failure.invalidResponse }
        guard response.statusCode == 200 else { throw Failure.http(response.statusCode) }
        guard response.mimeType == "application/json" else { throw Failure.invalidResponse }
        guard response.expectedContentLength <= Int64(Self.responseLimit) else { throw Failure.oversizedResponse }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < Self.responseLimit else { throw Failure.oversizedResponse }
            data.append(byte)
        }
        return data
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
