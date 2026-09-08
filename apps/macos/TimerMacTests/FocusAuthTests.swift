import Foundation
import Testing

@testable import TimerMac

@MainActor
@Suite(.timeLimit(.minutes(1)))
struct FocusAuthTests {
    private let environment = [
        "WELLSPENT_SUPABASE_URL": "https://auth.example.test",
        "WELLSPENT_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_fixture",
    ]
    private let api = "https://api.example.test"

    @Test
    func bundledSignInRestoresSessionThenSignOutSurvivesRestart() async throws {
        let suite = "focus-auth-bundle-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = AuthMemoryStorage()
        let transport = AuthTransport(replies: [.success, .logout])
        let bundle = environment.merging(["WELLSPENT_API_URL": api]) { _, new in new }
        let first = FocusAuthModel(
            client: FocusAuthClient(transport: transport.send), storage: store.storage,
            configurationDefaults: defaults, bundledConfiguration: bundle)
        await first.configure(apiBaseURL: api, environment: [:])
        #expect(first.configuration != nil)
        await first.performSignIn(email: "fixture@example.test", password: "fixture-password")
        #expect(first.canAccess)
        let restarted = model(store, transport, defaults: defaults)
        await restarted.configure(apiBaseURL: api, environment: [:])
        #expect(restarted.canAccess)
        #expect(restarted.user?.id == first.user?.id)
        await restarted.signOut()
        let signedOutRestart = model(store, transport, defaults: defaults)
        await signedOutRestart.configure(apiBaseURL: api, environment: [:])
        #expect(signedOutRestart.configuration != nil)
        #expect(signedOutRestart.canAccess == false)
        #expect(signedOutRestart.user == nil)
    }

    @Test
    func incorrectPasswordReportsFailureAndCanBeRetried() async throws {
        let store = AuthMemoryStorage()
        let transport = AuthTransport(replies: [.expired, .success])
        let auth = model(store, transport)
        var success = true
        await auth.configure(apiBaseURL: api, environment: environment)
        let task = try #require(
            auth.signIn(email: "fixture@example.test", password: "fixture-password") { success = $0 })
        await task.value
        #expect(!success)
        #expect(auth.message == FocusAuthError.invalidCredentials.localizedDescription)
        #expect(!auth.isSigningIn)
        #expect(auth.needsSignIn)
        #expect(store.values.isEmpty)
        await auth.performSignIn(email: "fixture@example.test", password: "fixture-password")
        #expect(auth.canAccess)
        for data in store.values.values {
            #expect(String(decoding: data, as: UTF8.self).contains("fixture-password") == false)
        }
    }

    @Test
    func confirmationAndRateLimitFailuresHaveDistinctRecovery() async {
        for (reply, expected) in [
            (AuthTransport.Reply.emailNotConfirmed, FocusAuthError.emailNotConfirmed), (.rateLimited, .rateLimited),
        ] {
            let auth = model(AuthMemoryStorage(), AuthTransport(replies: [reply]))
            await auth.configure(apiBaseURL: api, environment: environment)
            await auth.performSignIn(email: "fixture@example.test", password: "fixture-password")
            #expect(auth.message == expected.localizedDescription)
            #expect(auth.needsSignIn)
        }
    }

    @Test
    func restartRecoversPublicConfigurationOnlyForTheSameBackend() async throws {
        let suite = "focus-auth-configuration-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = AuthMemoryStorage()
        let transport = AuthTransport(replies: [.success])
        let auth = model(store, transport, defaults: defaults)
        await auth.configure(apiBaseURL: api, environment: environment)
        await auth.performSignIn(email: "fixture@example.test", password: "fixture-password")
        let restarted = model(store, transport, defaults: defaults)
        await restarted.configure(apiBaseURL: api, environment: [:])
        #expect(restarted.canAccess)
        let other = model(store, transport, defaults: defaults)
        await other.configure(apiBaseURL: "http://localhost:3001", environment: [:])
        #expect(other.configuration == nil)
        #expect(other.user == nil)
        let stored = defaults.dictionaryRepresentation().description
        #expect(!stored.contains("access-fixture"))
        #expect(!stored.contains("refresh-rotated"))
    }

    @Test
    func signInPersistsRestoresAndSignsOutWithoutChangingAccount() async throws {
        let store = AuthMemoryStorage()
        let transport = AuthTransport(replies: [.success, .logout])
        let auth = model(store, transport)
        await auth.configure(apiBaseURL: api, environment: environment)
        #expect(auth.needsSignIn)
        await auth.performSignIn(email: "fixture@example.test", password: "fixture-password")
        #expect(auth.canAccess)
        #expect(auth.user?.id == AuthTransport.userID)
        #expect(store.values.count == 1)
        let restarted = model(store, transport)
        await restarted.configure(apiBaseURL: api, environment: environment)
        #expect(restarted.canAccess)
        #expect(restarted.user?.id == auth.user?.id)
        let connection = try await restarted.connection()
        #expect(connection.accessToken == "access-fixture")
        await restarted.signOut()
        #expect(restarted.user == nil)
        #expect(restarted.needsSignIn)
        #expect(store.values.isEmpty)
        let again = model(store, transport)
        await again.configure(apiBaseURL: api, environment: environment)
        #expect(again.needsSignIn)
        #expect(await transport.count == 2)
    }

    @Test
    func refreshRotatesCredentialsBeforeReturningThem() async throws {
        let store = try expiredStore()
        let transport = AuthTransport(replies: [.success])
        let auth = model(store, transport)
        await auth.configure(apiBaseURL: api, environment: environment)
        let connection = try await auth.connection()
        #expect(connection.accessToken == "access-fixture")
        let configuration = try FocusAuthConfiguration(apiBaseURL: api, environment: environment)
        let data = try #require(store.values[configuration.storageScope])
        let saved = try JSONDecoder().decode(FocusAuthSession.self, from: data)
        #expect(saved.refreshToken == "refresh-rotated")
        #expect(saved.expiresAt > .now)
        #expect(await transport.count == 1)
    }

    @Test
    func invalidRefreshRequiresSignInAndKeepsAccountIdentity() async throws {
        let store = try expiredStore()
        let transport = AuthTransport(replies: [.expired])
        let auth = model(store, transport)
        await auth.configure(apiBaseURL: api, environment: environment)
        #expect(auth.needsSignIn)
        #expect(!auth.isRestoring)
        #expect(!auth.canAccess)
        #expect(auth.user?.id == AuthTransport.userID)
        #expect(auth.message?.contains("expired") == true)
        #expect(store.values.count == 1)
        await #expect(throws: FocusAuthError.self) { try await auth.connection() }
        #expect(await transport.count == 1)
    }

    @Test
    func networkFailureKeepsRefreshCredentialAndAllowsRetry() async throws {
        let store = try expiredStore()
        let transport = AuthTransport(replies: [.offline, .success])
        let auth = model(store, transport)
        await auth.configure(apiBaseURL: api, environment: environment)
        #expect(!auth.needsSignIn)
        #expect(auth.message != nil)
        #expect(store.values.count == 1)
        _ = try await auth.connection()
        #expect(auth.message == nil)
        #expect(await transport.count == 2)
    }

    @Test
    func concurrentRefreshIsSingleFlight() async throws {
        let store = try expiredStore()
        let transport = AuthTransport(replies: [.heldSuccess])
        let auth = model(store, transport)
        let restoring = Task { await auth.configure(apiBaseURL: api, environment: environment) }
        await transport.waitUntilHeld()
        let first = Task { try await auth.connection() }
        let second = Task { try await auth.connection() }
        await transport.release()
        await restoring.value
        _ = try await first.value
        _ = try await second.value
        #expect(await transport.count == 1)
        #expect(auth.canAccess)
    }

    @Test
    func signOutDuringRefreshCannotResurrectAccountOrKeychain() async throws {
        let store = try expiredStore()
        let transport = AuthTransport(replies: [.heldSuccess, .logout])
        let auth = model(store, transport)
        let restoring = Task { await auth.configure(apiBaseURL: api, environment: environment) }
        await transport.waitUntilHeld()
        await auth.signOut()
        await transport.release()
        await restoring.value
        #expect(auth.user == nil)
        #expect(auth.needsSignIn)
        #expect(store.values.isEmpty)
    }

    @Test
    func backendChangeRejectsLatePasswordResponse() async throws {
        let store = AuthMemoryStorage()
        let transport = AuthTransport(replies: [.heldSuccess])
        let auth = model(store, transport)
        await auth.configure(apiBaseURL: api, environment: environment)
        let login = Task { await auth.performSignIn(email: "fixture@example.test", password: "fixture-password") }
        await transport.waitUntilHeld()
        await auth.configure(apiBaseURL: "http://localhost:3001", environment: [:])
        await transport.release()
        await login.value
        #expect(auth.user == nil)
        #expect(store.values.isEmpty)
        #expect(auth.configuration == nil)
    }

    @Test
    func cancellationRejectsEvenANonCooperativeLatePasswordResponse() async throws {
        let store = AuthMemoryStorage()
        let transport = AuthTransport(replies: [.heldSuccess])
        let auth = model(store, transport)
        await auth.configure(apiBaseURL: api, environment: environment)
        let login = try #require(auth.signIn(email: "fixture@example.test", password: "fixture-password"))
        await transport.waitUntilHeld()
        auth.cancelSignIn()
        await transport.release()
        await login.value
        #expect(!auth.isSigningIn)
        #expect(auth.user == nil)
        #expect(store.values.isEmpty)
    }

    @Test
    func keychainFailureDoesNotReportSignOutOrLoseRotatedRefresh() async throws {
        let store = try expiredStore()
        store.failWrites = true
        let transport = AuthTransport(replies: [.success, .logout])
        let auth = model(store, transport)
        await auth.configure(apiBaseURL: api, environment: environment)
        #expect(auth.message == FocusAuthError.storage.localizedDescription)
        store.failWrites = false
        _ = try await auth.connection()
        #expect(await transport.count == 1)
        store.failWrites = true
        await auth.signOut()
        #expect(auth.user != nil)
        #expect(store.values.count == 1)
        store.failWrites = false
        await auth.signOut()
        #expect(auth.user == nil)
        #expect(store.values.isEmpty)
    }

    @Test
    func refreshCannotChangeTheUser() async throws {
        let store = try expiredStore()
        let transport = AuthTransport(replies: [.otherUser])
        let auth = model(store, transport)
        await auth.configure(apiBaseURL: api, environment: environment)
        #expect(auth.user?.id == AuthTransport.userID)
        #expect(auth.needsSignIn)
    }

    @Test
    func offlineSignOutStillRemovesLocalCredentials() async throws {
        let store = try expiredStore(expiresAt: .now.addingTimeInterval(3600))
        let transport = AuthTransport(replies: [.offline])
        let auth = model(store, transport)
        await auth.configure(apiBaseURL: api, environment: environment)
        await auth.signOut()
        #expect(auth.user == nil)
        #expect(store.values.isEmpty)
        #expect(auth.message?.contains("Signed out on this Mac") == true)
    }

    private func model(_ store: AuthMemoryStorage, _ transport: AuthTransport, defaults: UserDefaults? = nil)
        -> FocusAuthModel
    {
        FocusAuthModel(
            client: FocusAuthClient(transport: transport.send), storage: store.storage, configurationDefaults: defaults,
            bundledConfiguration: [:])
    }

    private func expiredStore(expiresAt: Date = .now.addingTimeInterval(-60)) throws -> AuthMemoryStorage {
        let store = AuthMemoryStorage()
        let configuration = try FocusAuthConfiguration(apiBaseURL: api, environment: environment)
        store.values[configuration.storageScope] = try JSONEncoder().encode(
            FocusAuthSession(
                accessToken: "expired-access", refreshToken: "refresh-original", expiresAt: expiresAt,
                user: .init(id: AuthTransport.userID, email: "fixture@example.test")))
        return store
    }
}

@MainActor
private final class AuthMemoryStorage {
    var values: [String: Data] = [:]
    var failWrites = false
    var storage: FocusAuthStorage {
        FocusAuthStorage(
            read: { self.values[$0] },
            write: { scope, data in
                if self.failWrites { throw FocusAuthError.storage }
                self.values[scope] = data
            })
    }
}

private actor AuthTransport {
    enum Reply { case success, heldSuccess, otherUser, expired, offline, logout, emailNotConfirmed, rateLimited }
    static let userID = UUID(uuid: (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16))
    private var replies: [Reply]
    private(set) var count = 0
    private var held: CheckedContinuation<Void, Never>?
    private var observer: CheckedContinuation<Void, Never>?
    init(replies: [Reply]) {
        self.replies = replies
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        count += 1
        try #require(!replies.isEmpty, "Unexpected auth request")
        let reply = replies.removeFirst()
        let url = try #require(request.url)
        #expect(url.query?.contains("fixture-password") == false)
        if url.query == "grant_type=password" {
            #expect(url.path == "/auth/v1/token")
            #expect(request.httpMethod == "POST")
            let body = try #require(request.httpBody)
            let credentials = try JSONDecoder().decode([String: String].self, from: body)
            #expect(credentials["email"] == "fixture@example.test")
            #expect(credentials["password"] == "fixture-password")
        }
        #expect(url.query?.contains("access_token") == false)
        #expect(url.query?.contains("refresh-original") == false)
        if case .offline = reply { throw URLError(.notConnectedToInternet) }
        if case .heldSuccess = reply {
            await withCheckedContinuation { continuation in
                held = continuation
                observer?.resume()
                observer = nil
            }
        }
        let status =
            reply == .rateLimited
            ? 429 : reply == .expired || reply == .emailNotConfirmed ? 400 : reply == .logout ? 204 : 200
        let response = try #require(HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil))
        if reply == .emailNotConfirmed { return (Data(#"{"error_code":"email_not_confirmed"}"#.utf8), response) }
        if reply == .logout || reply == .expired || reply == .rateLimited { return (Data(), response) }
        let id = reply == .otherUser ? UUID() : Self.userID
        let data = try JSONSerialization.data(withJSONObject: [
            "access_token": "access-fixture", "refresh_token": "refresh-rotated", "expires_in": 3600,
            "user": ["id": id.uuidString, "email": "fixture@example.test"],
        ])
        return (data, response)
    }

    func waitUntilHeld() async {
        guard held == nil else { return }
        await withCheckedContinuation { observer = $0 }
    }

    func release() {
        held?.resume()
        held = nil
    }
}
