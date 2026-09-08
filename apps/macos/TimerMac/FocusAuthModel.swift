import Foundation
import Observation

@MainActor
@Observable
final class FocusAuthModel {
    private(set) var user: FocusAuthSession.User?
    private(set) var isSigningIn = false
    private(set) var isRestoring = false
    private(set) var needsSignIn = true
    private(set) var message: String?
    private(set) var configuration: FocusAuthConfiguration?
    @ObservationIgnored private var session: FocusAuthSession?
    @ObservationIgnored private var pendingPersistence: FocusAuthSession?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var refreshTask: Task<FocusAuthSession, any Error>?
    @ObservationIgnored private var refreshTimer: Task<Void, Never>?
    @ObservationIgnored private var signInTask: Task<Void, Never>?
    @ObservationIgnored private let client: FocusAuthClient
    @ObservationIgnored private let storage: FocusAuthStorage
    @ObservationIgnored private let configurationDefaults: UserDefaults?
    @ObservationIgnored private let bundledConfiguration: [String: String]
    @ObservationIgnored var accountChanged: (@MainActor () -> Void)?

    init(
        client: FocusAuthClient = FocusAuthClient(), storage: FocusAuthStorage = .keychain,
        configurationDefaults: UserDefaults? = .standard,
        bundledConfiguration: [String: String] = FocusAuthConfiguration.bundledValues
    ) {
        self.client = client
        self.storage = storage
        self.configurationDefaults = configurationDefaults
        self.bundledConfiguration = bundledConfiguration
    }

    isolated deinit {
        refreshTimer?.cancel()
        refreshTask?.cancel()
        signInTask?.cancel()
    }

    var canAccess: Bool { session != nil && !needsSignIn && !isRestoring }

    func configure(apiBaseURL: String, environment: [String: String] = ProcessInfo.processInfo.environment) async {
        let next = try? FocusAuthConfiguration.resolve(
            apiBaseURL: apiBaseURL, environment: environment, bundled: bundledConfiguration,
            defaults: configurationDefaults)
        guard configuration != next || (configuration == nil && message == nil) else { return }
        reset()
        configuration = next
        accountChanged?()
        guard let next else {
            message = FocusAuthError.configuration.localizedDescription
            return
        }
        let generation = generation
        isRestoring = true
        defer {
            if self.generation == generation {
                isRestoring = false
                accountChanged?()
            }
        }
        do {
            if let data = try storage.read(next.storageScope) {
                let saved = try JSONDecoder().decode(FocusAuthSession.self, from: data)
                session = saved
                user = saved.user
                needsSignIn = false
                _ = try await validSession()
            }
        } catch {
            guard self.generation == generation else { return }
            message = Self.safeMessage(error)
        }
    }

    @discardableResult
    func signIn(email: String, password: String, onCompletion: @escaping @MainActor (Bool) -> Void = { _ in }) -> Task<
        Void, Never
    >? {
        guard !isSigningIn, !isRestoring else { return nil }
        let task = Task {
            await performSignIn(email: email, password: password)
            if !Task.isCancelled { onCompletion(canAccess) }
        }
        signInTask = task
        return task
    }

    func cancelSignIn() {
        guard isSigningIn else { return }
        generation = UUID()
        signInTask?.cancel()
        isSigningIn = false
        message = nil
    }

    func performSignIn(email: String, password: String) async {
        guard !isSigningIn, !isRestoring, let configuration else {
            message = FocusAuthError.configuration.localizedDescription
            return
        }
        isSigningIn = true
        message = nil
        let generation = generation
        defer { if self.generation == generation { isSigningIn = false } }
        do {
            let email = email.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !email.isEmpty, !password.isEmpty else { throw FocusAuthError.invalidCredentials }
            let next = try await client.signIn(configuration: configuration, email: email, password: password)
            try Task.checkCancellation()
            guard self.generation == generation else { return }
            // Stop any refresh of the previous session before committing the new account.
            refreshTask?.cancel()
            refreshTask = nil
            try install(next, configuration: configuration)
            self.generation = UUID()
            isSigningIn = false
        } catch {
            guard self.generation == generation else { return }
            message = Self.safeMessage(error)
        }
    }

    func connection() async throws -> FocusConnection {
        guard let configuration else { throw FocusAuthError.configuration }
        let generation = generation
        let session = try await validSession()
        guard self.generation == generation else { throw CancellationError() }
        return FocusConnection(apiBaseURL: configuration.apiURL.absoluteString, accessToken: session.accessToken)
    }

    func resume() async {
        guard session != nil, !needsSignIn else { return }
        do { _ = try await validSession() } catch {
            // validSession publishes a safe recovery message.
        }
    }

    func requireSignIn() {
        generation = UUID()
        refreshTask?.cancel()
        refreshTask = nil
        needsSignIn = true
        isRestoring = false
        refreshTimer?.cancel()
        message = FocusAuthError.expired.localizedDescription
        accountChanged?()
    }

    func signOut() async {
        guard let configuration else { return }
        // Clear durable credentials first. A Keychain failure must never report successful sign-out.
        do { try storage.write(configuration.storageScope, nil) } catch {
            message = FocusAuthError.storage.localizedDescription
            return
        }
        let old = pendingPersistence ?? session
        reset()
        accountChanged?()
        let generation = generation
        guard let old else { return }
        do { try await client.signOut(configuration: configuration, token: old.accessToken) } catch {
            guard self.generation == generation else { return }
            message =
                "Signed out on this Mac. The server could not confirm revocation; this Mac has removed its credentials."
        }
    }

    private func validSession() async throws -> FocusAuthSession {
        guard let session, let configuration, !needsSignIn else { throw FocusAuthError.expired }
        if let pendingPersistence {
            do { try install(pendingPersistence, configuration: configuration) } catch {
                message = FocusAuthError.storage.localizedDescription
                scheduleRefresh(session, retry: true)
                throw FocusAuthError.storage
            }
            return try await validSession()
        }
        if session.expiresAt.timeIntervalSinceNow > 60 {
            scheduleRefresh(session)
            return session
        }
        let generation = generation
        let task: Task<FocusAuthSession, any Error>
        if let refreshTask {
            task = refreshTask
        } else {
            let client = client
            task = Task { try await client.refresh(configuration: configuration, token: session.refreshToken) }
            refreshTask = task
        }
        do {
            let next = try await task.value
            guard self.generation == generation else { throw CancellationError() }
            guard next.user.id == session.user.id else { throw FocusAuthError.expired }
            if self.session?.refreshToken == session.refreshToken {
                pendingPersistence = next
                try install(next, configuration: configuration)
                refreshTask = nil
            }
            return next
        } catch {
            guard self.generation == generation else { throw CancellationError() }
            refreshTask = nil
            if case FocusAuthError.expired = error {
                requireSignIn()
            } else {
                message = Self.safeMessage(error)
                scheduleRefresh(session, retry: true)
            }
            throw error
        }
    }

    private func install(_ next: FocusAuthSession, configuration: FocusAuthConfiguration) throws {
        do { try storage.write(configuration.storageScope, JSONEncoder().encode(next)) } catch {
            throw FocusAuthError.storage
        }
        pendingPersistence = nil
        session = next
        user = next.user
        needsSignIn = false
        message = nil
        scheduleRefresh(next)
        accountChanged?()
    }

    private func scheduleRefresh(_ session: FocusAuthSession, retry: Bool = false) {
        refreshTimer?.cancel()
        let seconds = retry ? 30 : max(1, session.expiresAt.timeIntervalSinceNow - 60)
        refreshTimer = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(seconds)) } catch { return }
            await self?.resume()
        }
    }

    private func reset() {
        generation = UUID()
        refreshTask?.cancel()
        refreshTask = nil
        refreshTimer?.cancel()
        signInTask?.cancel()
        pendingPersistence = nil
        session = nil
        user = nil
        needsSignIn = true
        isSigningIn = false
        isRestoring = false
        message = nil
    }

    private static func safeMessage(_ error: any Error) -> String {
        if error is CancellationError { return FocusAuthError.cancelled.localizedDescription }
        return (error as? FocusAuthError)?.localizedDescription ?? FocusAuthError.unavailable.localizedDescription
    }
}
