import Foundation

struct FocusMutation: Sendable {
    enum Kind: Sendable { case create, transition, note, recap }
    let kind: Kind
    let sessionId: UUID
    let path: String
    let method: String
    let body: Data

    static func create(intention: String, now: Date = .now) throws -> Self {
        let id = UUID()
        return try Self(
            kind: .create, sessionId: id, path: "", method: "POST",
            payload: [
                "id": id.uuidString, "commandId": UUID().uuidString,
                "intention": intention, "occurredAt": timestamp(now),
            ])
    }

    static func transition(session: FocusSession, action: String, now: Date = .now) throws -> Self {
        try Self(
            kind: .transition, sessionId: session.id, path: "/\(session.id)/transitions", method: "POST",
            payload: [
                "commandId": UUID().uuidString, "action": action,
                "expectedRevision": session.revision, "occurredAt": timestamp(now),
            ])
    }

    static func note(session: FocusSession, text: String, now: Date = .now) throws -> Self {
        try Self(
            kind: .note, sessionId: session.id, path: "/\(session.id)/notes", method: "POST",
            payload: [
                "id": UUID().uuidString, "summary": text, "occurredAt": timestamp(now),
            ])
    }

    static func recap(session: FocusSession, text: String, expectedRevision: Int) throws -> Self {
        try Self(
            kind: .recap, sessionId: session.id, path: "/\(session.id)/recap", method: "PATCH",
            payload: [
                "text": text, "expectedRevision": expectedRevision,
            ])
    }

    private init(kind: Kind, sessionId: UUID, path: String, method: String, payload: [String: Any]) throws {
        self.kind = kind
        self.sessionId = sessionId
        self.path = path
        self.method = method
        body = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    }

    private static func timestamp(_ date: Date) -> String {
        date.formatted(
            .iso8601.year().month().day().time(includingFractionalSeconds: true).timeZone(separator: .omitted))
    }
}
