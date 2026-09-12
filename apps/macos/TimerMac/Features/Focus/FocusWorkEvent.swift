import Foundation

struct FocusWorkEvent: Decodable, Identifiable, Sendable {
    let id: UUID
    let source: String
    let occurredAt: Date
    let kind: String
    let summary: String
    let evidenceUrl: String?

    var evidenceLink: URL? {
        guard let evidenceUrl, let url = URL(string: evidenceUrl), url.scheme == "https" else { return nil }
        return url
    }
}
