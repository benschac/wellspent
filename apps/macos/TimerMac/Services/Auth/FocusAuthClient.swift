import Foundation

struct FocusAuthClient: Sendable {
    private let transport: FocusAPIClient.Transport
    private static let session = URLSession(
        configuration: .ephemeral, delegate: FocusHTTPDelegate(), delegateQueue: nil)

    init(transport: @escaping FocusAPIClient.Transport = FocusAuthClient.send) { self.transport = transport }

    func signIn(configuration: FocusAuthConfiguration, email: String, password: String) async throws -> FocusAuthSession
    {
        try await token(configuration, grant: "password", body: ["email": email, "password": password])
    }

    func refresh(configuration: FocusAuthConfiguration, token: String) async throws -> FocusAuthSession {
        try await self.token(configuration, grant: "refresh_token", body: ["refresh_token": token])
    }

    func signOut(configuration: FocusAuthConfiguration, token: String) async throws {
        _ = try await request(configuration, path: "logout", query: "scope=local", body: [:], token: token)
    }

    private func token(_ configuration: FocusAuthConfiguration, grant: String, body: [String: String]) async throws
        -> FocusAuthSession
    {
        let data = try await request(configuration, path: "token", query: "grant_type=\(grant)", body: body)
        struct Response: Decodable {
            let accessToken: String
            let refreshToken: String
            let expiresIn: Double
            let user: FocusAuthSession.User
        }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let value = try? decoder.decode(Response.self, from: data),
            !value.accessToken.isEmpty, !value.refreshToken.isEmpty,
            value.expiresIn.isFinite, value.expiresIn > 0
        else { throw FocusAuthError.invalidResponse }
        return FocusAuthSession(
            accessToken: value.accessToken, refreshToken: value.refreshToken,
            expiresAt: .now.addingTimeInterval(value.expiresIn), user: value.user)
    }

    private func request(
        _ configuration: FocusAuthConfiguration, path: String, query: String,
        body: [String: String], token: String? = nil
    ) async throws -> Data {
        var url = URLComponents(
            url: configuration.supabaseURL.appending(path: "auth/v1/\(path)"), resolvingAgainstBaseURL: false)
        url?.query = query
        guard let url = url?.url else { throw FocusAuthError.configuration }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await transport(request)
        guard (200..<300).contains(response.statusCode) else {
            if response.statusCode == 429 { throw FocusAuthError.rateLimited }
            if [400, 401, 403, 422].contains(response.statusCode) {
                if query == "grant_type=password" {
                    struct Failure: Decodable { let errorCode: String? }
                    let decoder = JSONDecoder()
                    decoder.keyDecodingStrategy = .convertFromSnakeCase
                    let failure = try? decoder.decode(Failure.self, from: data)
                    if failure?.errorCode == "email_not_confirmed" { throw FocusAuthError.emailNotConfirmed }
                    if failure?.errorCode == "captcha_failed" { throw FocusAuthError.verificationRequired }
                    throw FocusAuthError.invalidCredentials
                }
                throw FocusAuthError.expired
            }
            throw FocusAuthError.unavailable
        }
        return data
    }

    private static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw FocusAuthError.invalidResponse }
        return (data, response)
    }
}
