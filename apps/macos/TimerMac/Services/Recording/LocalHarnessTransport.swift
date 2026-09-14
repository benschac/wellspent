import CoreFoundation
import Foundation

/// Reuses the paired helper's bounded, proxy-free, redirect-free loopback transport.
struct LocalHarnessTransport: Sendable {
    private struct ResultResponse: Decodable {
        let nonce: String
        let status: String
    }
    private let transport: LocalCodexTransport

    init(endpoint: String) throws {
        transport = try LocalCodexTransport(endpoint: endpoint)
    }

    func poll(
        connection: LocalHarnessContract.Connection, epoch: UUID, active: LocalHarnessContract.Active?
    ) async throws -> LocalHarnessContract.PollResponse {
        let nonce = UUID().uuidString.lowercased()
        var fields = fresh(connection: connection, nonce: nonce)
        fields["epoch"] = epoch.uuidString.lowercased()
        if let active {
            fields["active"] = [
                "recordingID": active.recordingID.uuidString.lowercased(),
                "intervalID": active.intervalID.uuidString.lowercased(),
                "localScopeID": active.localScopeID,
            ]
        } else {
            fields["active"] = NSNull()
        }
        let data = try await transport.send(
            signed(fields, connection: connection, domain: "harness-poll"), path: "/v1/harness/poll")
        let packet = try envelope(data)
        let response = try LocalHarnessContract.decode(
            packet, key: connection.key, domain: "harness-response", as: LocalHarnessContract.PollResponse.self)
        let responseFields = try object(packet.body, keys: ["nonce", "request", "discovered"])
        guard response.nonce == nonce,
            let discovered = responseFields["discovered"] as? NSNumber,
            CFGetTypeID(discovered) == CFBooleanGetTypeID()
        else { throw LocalCodexTransport.Failure.invalidResponse }
        if !(responseFields["request"] is NSNull) {
            guard let request = responseFields["request"] as? [String: Any], Set(request.keys) == ["body", "mac"],
                let body = request["body"] as? String, let mac = request["mac"] as? String,
                let bytes = Data(base64Encoded: body), bytes.count <= 8192, bytes.base64EncodedString() == body,
                let signature = Data(base64Encoded: mac), signature.count == 32,
                signature.base64EncodedString() == mac
            else { throw LocalCodexTransport.Failure.invalidResponse }
        }
        return response
    }

    func complete(
        connection: LocalHarnessContract.Connection, request: CodexIntakeContract.Packet,
        note: LocalHarnessContract.Note, status: String, reason: String, nativeReceivedAt: Date?
    ) async throws {
        guard ["acknowledged", "rejected"].contains(status), reason.utf8.count <= 200 else {
            throw LocalCodexTransport.Failure.invalidResponse
        }
        let nonce = UUID().uuidString.lowercased()
        var fields = fresh(connection: connection, nonce: nonce)
        fields["eventID"] = note.eventID.uuidString.lowercased()
        fields["bodyDigest"] = CodexIntakeContract.digest(request.body)
        fields["status"] = status
        fields["reason"] = reason
        if let nativeReceivedAt {
            fields["nativeReceivedAt"] = CodexIntakeContract.timestamp(nativeReceivedAt)
        } else {
            fields["nativeReceivedAt"] = NSNull()
        }
        let data = try await transport.send(
            signed(fields, connection: connection, domain: "harness-result"), path: "/v1/harness/result")
        let packet = try envelope(data)
        let response = try LocalHarnessContract.decode(
            packet, key: connection.key, domain: "harness-response", as: ResultResponse.self)
        _ = try object(packet.body, keys: ["nonce", "status"])
        guard response.nonce == nonce, response.status == status else {
            throw LocalCodexTransport.Failure.invalidResponse
        }
    }

    private func fresh(connection: LocalHarnessContract.Connection, nonce: String) -> [String: Any] {
        [
            "version": 1, "connectionID": connection.connectionID.uuidString.lowercased(),
            "nonce": nonce, "issuedAt": CodexIntakeContract.timestamp(Date()),
        ]
    }

    private func signed(
        _ fields: [String: Any], connection: LocalHarnessContract.Connection, domain: String
    ) throws -> CodexIntakeContract.Packet {
        guard !connection.revoked, connection.key.count == 32 else { throw LocalCodexTransport.Failure.invalidKey }
        return CodexIntakeContract.sign(
            try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]), key: connection.key,
            domain: domain)
    }

    private func object(_ data: Data, keys: Set<String>) throws -> [String: Any] {
        guard let fields = try JSONSerialization.jsonObject(with: data) as? [String: Any], Set(fields.keys) == keys
        else {
            throw LocalCodexTransport.Failure.invalidResponse
        }
        return fields
    }

    private func envelope(_ data: Data) throws -> CodexIntakeContract.Packet {
        let fields = try object(data, keys: ["body", "mac"])
        guard let body = fields["body"] as? String, let mac = fields["mac"] as? String,
            let decodedBody = Data(base64Encoded: body), decodedBody.base64EncodedString() == body,
            let decodedMAC = Data(base64Encoded: mac), decodedMAC.count == 32,
            decodedMAC.base64EncodedString() == mac
        else { throw LocalCodexTransport.Failure.invalidResponse }
        return .init(body: decodedBody, mac: decodedMAC)
    }
}
