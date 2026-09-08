import Foundation
import Observation

@MainActor
@Observable
final class FocusModel {
    private(set) var sessions: [FocusSession] = []
    private(set) var detail: FocusDetail?
    private(set) var selectedID: UUID?
    private(set) var isBusy = false
    private(set) var errorMessage: String?
    private(set) var pendingMutation: FocusMutation?
    private(set) var lastRefreshed: Date?
    var intention = ""
    var note = ""
    var recap = ""
    private(set) var recapDraftRevision = 0
    private var savedRecap = ""
    @ObservationIgnored private var connection: FocusConnection?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private let client: FocusAPIClient
    @ObservationIgnored var authenticatedConnection: (@MainActor () async throws -> FocusConnection)?
    @ObservationIgnored var authenticationRejected: (@MainActor () -> Void)?
    @ObservationIgnored private var accountScope: String?
    @ObservationIgnored private var accountID: UUID?
    private(set) var isAuthenticated = false

    init(client: FocusAPIClient = FocusAPIClient()) { self.client = client }

    var canWrite: Bool {
        !isBusy && pendingMutation == nil
            && (authenticatedConnection != nil ? isAuthenticated : connection?.accessToken.isEmpty == false)
    }
    var hasAccountWork: Bool { !intention.isEmpty || !note.isEmpty || hasRecapChanges || pendingMutation != nil }

    func configureAccount(apiBaseURL: String, userID: UUID?, available: Bool) {
        let scope = "\(apiBaseURL)|\(userID?.uuidString ?? "signed-out")"
        if accountScope != scope {
            let anonymousIntention = accountID == nil && userID != nil ? intention : ""
            // Identity, not the rotating bearer token, owns the Focus lifetime.
            configure(FocusConnection(apiBaseURL: apiBaseURL, accessToken: userID?.uuidString ?? ""))
            accountScope = scope
            accountID = userID
            intention = anonymousIntention
        }
        isAuthenticated = available
    }
    var hasRecapChanges: Bool { recap != savedRecap }
    private var hasSessionDraft: Bool { !note.isEmpty || hasRecapChanges }

    func configure(_ connection: FocusConnection) {
        guard self.connection != connection else { return }
        self.connection = connection
        generation = UUID()
        sessions = []
        detail = nil
        selectedID = nil
        pendingMutation = nil
        lastRefreshed = nil
        intention = ""
        note = ""
        recap = ""
        savedRecap = ""
        recapDraftRevision = 0
        errorMessage = nil
        isBusy = false
    }

    func refresh() async {
        guard !isBusy, let connection, authenticatedConnection == nil || isAuthenticated else { return }
        let generation = generation
        isBusy = true
        errorMessage = nil
        defer { if self.generation == generation { isBusy = false } }
        do {
            let sessions = try await request([FocusSession].self, connection: connection)
            guard self.generation == generation else { return }
            self.sessions = sessions
            let listedSelection = selectedID.flatMap { id in sessions.first(where: { $0.id == id })?.id }
            let retainedSelection = selectedID.flatMap { id -> UUID? in
                guard listedSelection == nil, detail?.session.id == id, hasSessionDraft else { return nil }
                if let currentSession = detail?.session { upsert(currentSession) }
                return id
            }
            let selection = listedSelection ?? retainedSelection ?? sessions.first?.id
            if let selection {
                let detail = try await request(FocusDetail.self, connection: connection, path: "/\(selection)")
                guard self.generation == generation else { return }
                apply(detail, preserveDraft: selectedID == selection)
                if retainedSelection != nil { upsert(detail.session) }
            } else {
                self.detail = nil
                selectedID = nil
            }
            lastRefreshed = .now
        } catch {
            guard self.generation == generation else { return }
            errorMessage = error is FocusAuthError || error is CancellationError ? nil : error.localizedDescription
        }
    }

    func select(_ id: UUID) async {
        guard !isBusy, pendingMutation == nil, id != selectedID, let connection else { return }
        let generation = generation
        isBusy = true
        errorMessage = nil
        defer { if self.generation == generation { isBusy = false } }
        do {
            let detail = try await request(FocusDetail.self, connection: connection, path: "/\(id)")
            guard self.generation == generation else { return }
            note = ""
            apply(detail, preserveDraft: false)
        } catch {
            guard self.generation == generation else { return }
            errorMessage = error is FocusAuthError || error is CancellationError ? nil : error.localizedDescription
        }
    }

    func create() async {
        let text = intention.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canWrite, (1...500).contains(text.utf16.count) else { return }
        await submit { try .create(intention: text) }
    }

    func transition(_ action: String) async {
        guard canWrite, let session = detail?.session,
            ["pause", "resume", "finish"].contains(action)
        else { return }
        await submit { try .transition(session: session, action: action) }
    }

    func addNote() async {
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canWrite, let session = detail?.session, (1...2000).contains(text.utf16.count) else { return }
        await submit { try .note(session: session, text: text) }
    }

    func saveRecap() async {
        let text = recap.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canWrite, let session = detail?.session, text.utf16.count <= 8000 else { return }
        await submit { try .recap(session: session, text: text, expectedRevision: recapDraftRevision) }
    }

    func reloadRecap() {
        guard let session = detail?.session else { return }
        recap = session.recapText ?? ""
        savedRecap = recap
        recapDraftRevision = session.recapRevision
    }

    private func submit(_ make: () throws -> FocusMutation) async {
        do {
            pendingMutation = try make()
            await retrySave()
        } catch {
            errorMessage = error is FocusAuthError || error is CancellationError ? nil : error.localizedDescription
        }
    }

    func retrySave() async {
        guard !isBusy, let mutation = pendingMutation, let connection,
            authenticatedConnection == nil || isAuthenticated
        else { return }
        let generation = generation
        isBusy = true
        errorMessage = nil
        defer { if self.generation == generation { isBusy = false } }
        do {
            switch mutation.kind {
            case .create, .transition:
                let session = try await request(
                    FocusSession.self, connection: connection, path: mutation.path, method: mutation.method,
                    body: mutation.body)
                guard self.generation == generation else { return }
                upsert(session)
                selectedID = session.id
                detail = nil
                if mutation.kind == .create {
                    intention = ""
                    note = ""
                    recap = ""
                    savedRecap = ""
                    recapDraftRevision = 0
                }
            case .note, .recap:
                let detail = try await request(
                    FocusDetail.self, connection: connection, path: mutation.path, method: mutation.method,
                    body: mutation.body)
                guard self.generation == generation else { return }
                apply(detail, preserveDraft: mutation.kind != .recap)
                upsert(detail.session)
                if mutation.kind == .note { note = "" }
            }
            pendingMutation = nil
            // A successful write remains confirmed even if this follow-up read fails.
            if mutation.kind == .create || mutation.kind == .transition {
                let detail = try await request(
                    FocusDetail.self, connection: connection, path: "/\(mutation.sessionId)")
                guard self.generation == generation else { return }
                apply(detail, preserveDraft: mutation.kind != .create)
            }
            lastRefreshed = .now
        } catch {
            guard self.generation == generation else { return }
            if let apiError = error as? FocusAPIError, apiError.isDefinitiveRejection { pendingMutation = nil }
            if error is FocusAuthError || error is CancellationError { return }
            errorMessage =
                pendingMutation == nil
                ? error.localizedDescription
                : "Save not confirmed. Retry uses the same request. \(error.localizedDescription)"
        }
    }

    private func request<Value: Decodable & Sendable>(
        _ type: Value.Type, connection: FocusConnection, path: String = "",
        method: String = "GET", body: Data? = nil
    ) async throws -> Value {
        let generation = generation
        let active = try await authenticatedConnection?() ?? connection
        guard self.generation == generation else { throw CancellationError() }
        do {
            return try await client.request(type, connection: active, path: path, method: method, body: body)
        } catch FocusAPIError.http(401) where authenticatedConnection != nil {
            guard self.generation == generation else { throw CancellationError() }
            authenticationRejected?()
            throw FocusAuthError.expired
        }
    }

    private func apply(_ detail: FocusDetail, preserveDraft: Bool) {
        let preserve = preserveDraft && hasRecapChanges
        self.detail = detail
        selectedID = detail.session.id
        if !preserve { reloadRecap() }
    }

    private func upsert(_ session: FocusSession) {
        sessions.removeAll { $0.id == session.id }
        sessions.append(session)
        sessions.sort { $0.createdAt > $1.createdAt }
    }
}
