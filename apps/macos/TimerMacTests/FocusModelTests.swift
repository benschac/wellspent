import Foundation
import Testing

@testable import TimerMac

@MainActor
struct FocusModelTests {
    private let connection = FocusConnection(apiBaseURL: "https://example.test", accessToken: "account-a")

    @Test
    func sameAccountRefreshAndReauthenticationPreserveWorkButSignOutClearsIt() async throws {
        let transport = FocusModelTransport(replies: [.list, .detail, .failure])
        let model = FocusModel(client: FocusAPIClient(transport: transport.send))
        let account = UUID()
        model.authenticatedConnection = { connection }
        model.configureAccount(apiBaseURL: connection.apiBaseURL, userID: nil, available: false)
        model.intention = "An intention written before signing in"
        model.configureAccount(apiBaseURL: connection.apiBaseURL, userID: account, available: true)
        #expect(!model.intention.isEmpty)
        await model.refresh()
        await model.create()
        let pending = try #require(model.pendingMutation)
        model.note = "Private note"
        model.recap = "Private recap"
        model.configureAccount(apiBaseURL: connection.apiBaseURL, userID: account, available: false)
        #expect(!model.canWrite)
        #expect(model.pendingMutation?.body == pending.body)
        #expect(model.note == "Private note")
        model.configureAccount(apiBaseURL: connection.apiBaseURL, userID: account, available: true)
        #expect(model.recap == "Private recap")
        #expect(model.pendingMutation?.body == pending.body)
        model.configureAccount(apiBaseURL: connection.apiBaseURL, userID: nil, available: false)
        #expect(model.sessions.isEmpty)
        #expect(model.pendingMutation == nil)
        #expect(model.note.isEmpty)
        #expect(model.recap.isEmpty)
        #expect(model.intention.isEmpty)
    }

    @Test
    func signedOutNeverFetchesAndAccountSwitchDiscardsLateListResponse() async throws {
        let transport = FocusModelTransport(replies: [.heldList])
        let model = FocusModel(client: FocusAPIClient(transport: transport.send))
        model.authenticatedConnection = { connection }
        model.configureAccount(apiBaseURL: connection.apiBaseURL, userID: nil, available: false)
        await model.refresh()
        #expect(await transport.requests.isEmpty)
        model.configureAccount(apiBaseURL: connection.apiBaseURL, userID: UUID(), available: true)
        let loading = Task { await model.refresh() }
        await transport.waitUntilHeld()
        model.configureAccount(apiBaseURL: connection.apiBaseURL, userID: UUID(), available: true)
        await transport.release()
        await loading.value
        #expect(model.sessions.isEmpty)
        #expect(model.detail == nil)
        #expect(model.lastRefreshed == nil)
    }

    @Test
    func uncertainCreateRetriesTheExactCommandAndClearsPendingAfterSuccess() async throws {
        let transport = FocusModelTransport(replies: [.failure, .session, .detail])
        let model = FocusModel(client: FocusAPIClient(transport: transport.send))
        model.configure(connection)
        model.intention = "Write the proposal"

        await model.create()

        let pending = try #require(model.pendingMutation)
        #expect(model.canWrite == false)
        #expect(model.errorMessage?.contains("Save not confirmed") == true)
        #expect(model.intention == "Write the proposal")
        await model.retrySave()

        let requests = await transport.requests
        try #require(requests.count == 3)
        #expect(requests[0].httpBody == pending.body)
        #expect(requests[1].httpBody == pending.body)
        #expect(requests[0].url == requests[1].url)
        #expect(requests[0].httpMethod == requests[1].httpMethod)
        let payload = try #require(JSONSerialization.jsonObject(with: pending.body) as? [String: Any])
        let commandID = try #require(payload["commandId"] as? String)
        #expect(UUID(uuidString: commandID) != nil)
        #expect(model.pendingMutation == nil)
        #expect(model.canWrite)
        #expect(model.intention.isEmpty)
        #expect(model.errorMessage == nil)
        #expect(model.detail != nil)
    }

    @Test
    func rateLimitedCreateRetainsTheExactCommandForRetry() async throws {
        let transport = FocusModelTransport(replies: [.rateLimited, .session, .detail])
        let model = FocusModel(client: FocusAPIClient(transport: transport.send))
        model.configure(connection)
        model.intention = "Write the proposal"

        await model.create()

        let pending = try #require(model.pendingMutation)
        #expect(model.errorMessage?.contains("Save not confirmed") == true)
        await model.retrySave()

        let requests = await transport.requests
        try #require(requests.count == 3)
        #expect(requests[0].httpBody == pending.body)
        #expect(requests[1].httpBody == pending.body)
        #expect(requests[0].url == requests[1].url)
        #expect(model.pendingMutation == nil)
        #expect(model.errorMessage == nil)
    }

    @Test
    func confirmedCreateDoesNotKeepOldRecapWhenDetailReadFails() async throws {
        let transport = FocusModelTransport(replies: [.list, .detail, .session, .failure])
        let model = FocusModel(client: FocusAPIClient(transport: transport.send))
        model.configure(connection)
        await model.refresh()
        model.recap = "An old unsaved draft"
        model.intention = "New session"

        await model.create()

        #expect(model.pendingMutation == nil)
        #expect(model.intention.isEmpty)
        #expect(model.recap.isEmpty)
        #expect(model.hasRecapChanges == false)
        #expect(model.detail == nil)
        #expect(model.sessions.count == 2)
        #expect(model.canWrite)
    }

    @Test
    func accountChangeClearsStateAndIgnoresOldInFlightResponse() async throws {
        let transport = FocusModelTransport(replies: [.list, .detail, .failure, .heldList])
        let model = FocusModel(client: FocusAPIClient(transport: transport.send))
        model.configure(connection)
        await model.refresh()
        try #require(model.detail != nil)
        model.intention = "Private intention"
        await model.create()
        try #require(model.pendingMutation != nil)
        model.note = "Private note"
        model.recap = "Private recap"

        let oldRefresh = Task { await model.refresh() }
        await transport.waitUntilHeld()
        model.configure(FocusConnection(apiBaseURL: "https://example.test", accessToken: "account-b"))

        #expect(model.sessions.isEmpty)
        #expect(model.detail == nil)
        #expect(model.selectedID == nil)
        #expect(model.intention.isEmpty)
        #expect(model.note.isEmpty)
        #expect(model.recap.isEmpty)
        #expect(model.recapDraftRevision == 0)
        #expect(model.pendingMutation == nil)
        #expect(model.errorMessage == nil)
        #expect(model.lastRefreshed == nil)
        #expect(model.isBusy == false)
        await transport.release()
        await oldRefresh.value

        #expect(model.sessions.isEmpty)
        #expect(model.detail == nil)
        #expect(model.lastRefreshed == nil)
        #expect(model.errorMessage == nil)
        #expect(await transport.requests.count == 4)
    }

    @Test
    func recapDraftRetainsItsRevisionAcrossRemoteRefresh() async throws {
        let transport = FocusModelTransport(replies: [.list, .detail, .list, .newerDetail, .failure])
        let model = FocusModel(client: FocusAPIClient(transport: transport.send))
        model.configure(connection)
        await model.refresh()
        #expect(model.recapDraftRevision == 2)
        model.recap = "My unsaved recap"

        await model.refresh()

        #expect(model.detail?.session.recapRevision == 3)
        #expect(model.recap == "My unsaved recap")
        #expect(model.recapDraftRevision == 2)
        await model.saveRecap()
        let pending = try #require(model.pendingMutation)
        let payload = try #require(JSONSerialization.jsonObject(with: pending.body) as? [String: Any])
        #expect(payload["text"] as? String == "My unsaved recap")
        #expect(payload["expectedRevision"] as? Int == 2)
    }

    @Test
    func refreshRetainsAnUnlistedSelectionUntilItsNoteAndRecapDraftsAreResolved() async throws {
        let transport = FocusModelTransport(
            replies: [.list, .detail, .replacementList, .newerDetail, .replacementList, .detail])
        let model = FocusModel(client: FocusAPIClient(transport: transport.send))
        model.configure(connection)
        await model.refresh()
        let originalID = try #require(model.selectedID)
        model.note = "Unsaved note"
        model.recap = "Unsaved recap"

        await model.refresh()

        #expect(model.selectedID == originalID)
        #expect(model.detail?.session.id == originalID)
        #expect(model.note == "Unsaved note")
        #expect(model.recap == "Unsaved recap")
        #expect(model.sessions.contains { $0.id == originalID })
        #expect(model.sessions.count == 2)

        model.note = ""
        model.reloadRecap()
        await model.refresh()

        #expect(model.selectedID != originalID)
        #expect(model.detail?.session.id == model.selectedID)
        #expect(model.sessions.count == 1)
        #expect(model.note.isEmpty)
        #expect(model.recap == "Saved recap 2")
    }
}

private actor FocusModelTransport {
    enum Reply: Sendable {
        case failure, rateLimited, session, detail, newerDetail, list, replacementList, heldList
    }
    private var replies: [Reply]
    private(set) var requests: [URLRequest] = []
    private var held: CheckedContinuation<Void, Never>?
    private var heldObserver: CheckedContinuation<Void, Never>?

    init(replies: [Reply]) { self.replies = replies }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        try #require(replies.isEmpty == false, "Unexpected transport request")
        let reply = replies.removeFirst()
        if case .failure = reply { throw URLError(.networkConnectionLost) }
        if case .heldList = reply {
            await withCheckedContinuation { continuation in
                held = continuation
                heldObserver?.resume()
                heldObserver = nil
            }
        }
        let url = try #require(request.url)
        let statusCode = if case .rateLimited = reply { 429 } else { 200 }
        let response = try #require(
            HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil)
        )
        let data: Data
        switch reply {
        case .session:
            let body = try #require(request.httpBody)
            let payload = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
            let id = try #require(payload["id"] as? String)
            data = try JSONSerialization.data(withJSONObject: Self.session(id: id))
        case .detail, .newerDetail:
            let id = url.lastPathComponent
            let revision = reply == .newerDetail ? 3 : 2
            data = try JSONSerialization.data(withJSONObject: [
                "session": Self.session(id: id, recapRevision: revision), "events": [],
                "generatedRecap": "", "segmentsTruncated": false,
            ])
        case .list, .heldList:
            data = try JSONSerialization.data(withJSONObject: [Self.session()])
        case .replacementList:
            data = try JSONSerialization.data(
                withJSONObject: [Self.session(id: "A08AF985-6A25-460A-8B05-C77E4F58D70A")]
            )
        case .rateLimited:
            data = Data()
        case .failure:
            throw URLError(.networkConnectionLost)
        }
        return (data, response)
    }

    func waitUntilHeld() async {
        guard held == nil else { return }
        await withCheckedContinuation { heldObserver = $0 }
    }

    func release() {
        held?.resume()
        held = nil
    }

    private static func session(
        id: String = "862AF25A-6DC2-4475-A230-C641D0389B3D", recapRevision: Int = 2
    ) -> [String: Any] {
        [
            "id": id, "intention": "Write the proposal", "status": "paused", "elapsedMs": 1500,
            "revision": 4, "createdAt": "2026-09-08T12:00:00Z", "updatedAt": "2026-09-08T12:01:00Z",
            "recapText": "Saved recap \(recapRevision)", "recapRevision": recapRevision,
        ]
    }
}
