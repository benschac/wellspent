import Foundation

enum FocusAuthError: Error, LocalizedError {
    case configuration, cancelled, expired, unavailable, storage, invalidResponse
    case invalidCredentials, emailNotConfirmed, rateLimited, verificationRequired

    var errorDescription: String? {
        switch self {
        case .configuration: "Sign-in isn’t configured for this backend. See the macOS authentication setup guide."
        case .cancelled: "Sign-in was cancelled. You can try again whenever you’re ready."
        case .expired: "Your session expired. Sign in again to continue. Your unsaved work is still here."
        case .unavailable: "Couldn’t reach sign-in. Check your connection and try again."
        case .storage: "Couldn’t access your account in Keychain. Unlock your Mac and try again."
        case .invalidResponse: "Sign-in returned an unexpected response. Please try again."
        case .invalidCredentials: "The email or password wasn’t accepted. Check both and try again."
        case .emailNotConfirmed: "Confirm your email using the link in your inbox, then sign in again."
        case .rateLimited: "Too many sign-in attempts. Wait a moment, then try again."
        case .verificationRequired:
            "This account requires additional verification. Complete it on the web, then try again."
        }
    }
}
