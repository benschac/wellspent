import Foundation

struct FocusConnection: Equatable, Sendable {
    let apiBaseURL: String
    let accessToken: String

    var diagnosticEndpoint: String { (try? endpoint(path: "").absoluteString) ?? "Invalid API URL" }

    func request(path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard !accessToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw FocusAPIError.signInRequired
        }
        var request = URLRequest(url: try endpoint(path: path))
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 20
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func endpoint(path: String) throws -> URL {
        guard var components = URLComponents(string: apiBaseURL),
            let host = components.host, !host.isEmpty
        else { throw FocusAPIError.invalidURL }
        switch components.scheme {
        case "https", "wss": components.scheme = "https"
        case "http", "ws": components.scheme = "http"
        default: throw FocusAPIError.invalidURL
        }
        components.user = nil
        components.password = nil
        components.query = nil
        components.fragment = nil
        components.path = "/api/focus/sessions" + path
        guard let url = components.url else { throw FocusAPIError.invalidURL }
        return url
    }
}
