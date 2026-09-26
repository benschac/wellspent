import Foundation
import Testing

@testable import TimerMac

struct FocusAPIClientTests {
    @Test(arguments: [("ws", "http"), ("wss", "https")])
    func connectionUsesAPIRouteAndRemovesEmbeddedCredentials(schemes: (String, String)) throws {
        let connection = FocusConnection(
            apiBaseURL: "\(schemes.0)://old-user:old-password@example.test:8080/api/ws?token=old#fragment",
            accessToken: "account-token"
        )
        let body = Data(#"{"commandId":"command-1"}"#.utf8)
        let request = try connection.request(path: "/session-1/pause", method: "POST", body: body)

        #expect(request.url?.absoluteString == "\(schemes.1)://example.test:8080/api/focus/sessions/session-1/pause")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer account-token")
        #expect(request.httpMethod == "POST")
        #expect(request.httpBody == body)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }

    @Test(arguments: ["file:///tmp/session", "ftp://example.test", "not a URL"])
    func invalidAPIOriginsAreRejected(origin: String) {
        do {
            _ = try FocusConnection(apiBaseURL: origin, accessToken: "token").request(path: "")
            Issue.record("Expected an invalid URL error")
        } catch FocusAPIError.invalidURL {
            // Invalid origins must fail before creating a request.
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test
    func missingAuthenticationNeverCallsTransport() async {
        await confirmation(expectedCount: 0) { transportCalled in
            let client = FocusAPIClient { _ in
                transportCalled()
                throw URLError(.badServerResponse)
            }
            do {
                _ = try await client.request(
                    [FocusSession].self,
                    connection: FocusConnection(apiBaseURL: "https://example.test", accessToken: " \n")
                )
                Issue.record("Expected a sign-in error")
            } catch FocusAPIError.signInRequired {
                // Authentication is checked locally, before transport.
            } catch {
                Issue.record("Unexpected error: \(error)")
            }
        }
    }

    @Test(arguments: [401, 403, 409, 500])
    func httpFailuresRetainStatusWithoutDecodingBody(status: Int) async throws {
        let client = FocusAPIClient { request in
            let url = try #require(request.url)
            let response = try #require(
                HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)
            )
            return (Data("not JSON".utf8), response)
        }
        do {
            _ = try await client.request(
                [FocusSession].self,
                connection: FocusConnection(apiBaseURL: "https://example.test", accessToken: "token")
            )
            Issue.record("Expected an HTTP error")
        } catch FocusAPIError.http(let actualStatus) {
            #expect(actualStatus == status)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test(arguments: ["2026-09-08T12:00:00.125Z", "2026-09-08T12:00:00Z"])
    func serverSessionsDecodeAndProjectRunningTime(timestamp: String) async throws {
        let data = Self.sessionJSON(timestamp: timestamp)
        let client = FocusAPIClient { request in
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token")
            let url = try #require(request.url)
            let response = try #require(
                HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)
            )
            return (data, response)
        }
        let session = try await client.request(
            FocusSession.self,
            connection: FocusConnection(apiBaseURL: "https://example.test", accessToken: "token")
        )
        let runningSince = try #require(session.runningSince)
        let fractionalOffset = timestamp.contains(".125") ? 0.125 : 0
        #expect(abs(runningSince.timeIntervalSince1970 - (1_788_868_800 + fractionalOffset)) < 0.001)
        #expect(session.createdAt == runningSince)
        #expect(session.updatedAt == runningSince)
        #expect(session.revision == 3)
        #expect(session.recapRevision == 0)
        #expect(session.elapsedMilliseconds(at: runningSince.addingTimeInterval(2)) == 3_500)
        #expect(session.elapsedMilliseconds(at: runningSince.addingTimeInterval(-2)) == 1_500)
    }

    @Test(arguments: ["paused", "completed"])
    func stoppedSessionsDoNotAccumulateTime(status: String) throws {
        let session = try FocusAPIClient.decoder().decode(
            FocusSession.self, from: Self.sessionJSON(timestamp: "2026-09-08T12:00:00Z", status: status)
        )
        #expect(session.elapsedMilliseconds(at: session.updatedAt.addingTimeInterval(60)) == 1_500)
    }

    @Test
    func malformedServerTimestampFailsAtDecodeBoundary() {
        #expect(throws: DecodingError.self) {
            try FocusAPIClient.decoder().decode(
                FocusSession.self, from: Self.sessionJSON(timestamp: "yesterday")
            )
        }
    }

    private static func sessionJSON(timestamp: String, status: String = "running") -> Data {
        Data(
            """
            {"id":"862AF25A-6DC2-4475-A230-C641D0389B3D","intention":"Write the proposal",
            "status":"\(status)","elapsedMs":1500,"runningSince":"\(timestamp)",
            "revision":3,"createdAt":"\(timestamp)","updatedAt":"\(timestamp)",
            "completedAt":null,"recapText":null,"recapRevision":0}
            """.utf8
        )
    }
}
