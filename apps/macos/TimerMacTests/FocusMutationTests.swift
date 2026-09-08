import Foundation
import Testing

@testable import TimerMac

struct FocusMutationTests {
    @Test
    func creationPreservesUTCTransportMilliseconds() throws {
        let now = Date(timeIntervalSince1970: 1_788_868_800.125)
        let mutation = try FocusMutation.create(intention: "Write proposal", now: now)
        let body = try #require(JSONSerialization.jsonObject(with: mutation.body) as? [String: Any])
        #expect(body["occurredAt"] as? String == "2026-09-08T12:00:00.125Z")
        #expect(body["id"] as? String == mutation.sessionId.uuidString)
        #expect(mutation.path.isEmpty)
        #expect(mutation.method == "POST")
    }

    @Test(arguments: ["pause", "resume", "finish"])
    func transitionsUseTheTimerRevisionAndMountedRoute(action: String) throws {
        let mutation = try FocusMutation.transition(session: session(), action: action)
        let body = try #require(JSONSerialization.jsonObject(with: mutation.body) as? [String: Any])
        #expect(mutation.path == "/\(mutation.sessionId)/transitions")
        #expect(mutation.method == "POST")
        #expect(body["expectedRevision"] as? Int == 7)
        #expect(body["action"] as? String == action)
        #expect(body["sessionId"] == nil)  // The route supplies the session ID.
        let commandID = try #require(body["commandId"] as? String)
        #expect(UUID(uuidString: commandID) != nil)
    }

    @Test
    func notesHaveStableIdsAndRecapsUseTheirOwnDraftRevision() throws {
        let session = try session()
        let note = try FocusMutation.note(session: session, text: "A note")
        let noteBody = try #require(JSONSerialization.jsonObject(with: note.body) as? [String: Any])
        let noteID = try #require(noteBody["id"] as? String)
        #expect(UUID(uuidString: noteID) != nil)
        #expect(noteBody["summary"] as? String == "A note")
        #expect(note.path == "/\(session.id)/notes")
        let recap = try FocusMutation.recap(session: session, text: "My recap", expectedRevision: 1)
        let recapBody = try #require(JSONSerialization.jsonObject(with: recap.body) as? [String: Any])
        #expect(recapBody["expectedRevision"] as? Int == 1)
        #expect(recap.method == "PATCH")
        #expect(recap.path == "/\(session.id)/recap")
    }

    private func session() throws -> FocusSession {
        try FocusAPIClient.decoder().decode(
            FocusSession.self,
            from: Data(
                #"{"id":"862AF25A-6DC2-4475-A230-C641D0389B3D","intention":"Write","status":"running","elapsedMs":1500,"runningSince":"2026-09-08T12:00:00Z","revision":7,"createdAt":"2026-09-08T12:00:00Z","updatedAt":"2026-09-08T12:01:00Z","recapText":"Recap","recapRevision":2}"#
                    .utf8))
    }
}
