import Foundation

enum FocusAPIError: LocalizedError {
    case signInRequired
    case invalidURL
    case invalidResponse
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .signInRequired: "Sign in to use Focus."
        case .invalidURL: "Enter a valid API URL in Settings."
        case .invalidResponse: "The Focus API returned an invalid response."
        case .http(401), .http(403): "Your Focus sign-in expired or was rejected. Sign in again."
        case .http(409): "This session changed on another device. Refresh before making another change."
        case .http(400), .http(422): "The Focus API rejected this change. Refresh the session and check your input."
        case .http(404): "This focus session is no longer available. Refresh the session list."
        case .http(let status): "The Focus API could not complete the request (HTTP \(status))."
        }
    }

    var isDefinitiveRejection: Bool {
        switch self {
        case .signInRequired, .invalidURL: true
        case .http(let status): (400..<500).contains(status) && status != 408 && status != 429
        case .invalidResponse: false
        }
    }
}
