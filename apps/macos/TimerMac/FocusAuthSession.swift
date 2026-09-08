import Foundation

struct FocusAuthSession: Codable, Sendable {
    struct User: Codable, Sendable {
        let id: UUID
        let email: String?
    }
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let user: User
}
