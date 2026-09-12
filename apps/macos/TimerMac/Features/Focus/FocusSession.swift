import Foundation

struct FocusSession: Decodable, Identifiable, Sendable {
    let id: UUID
    let intention: String
    let status: Status
    let elapsedMs: Double
    let runningSince: Date?
    let revision: Int
    let createdAt: Date
    let updatedAt: Date
    let completedAt: Date?
    let recapText: String?
    let recapRevision: Int

    enum Status: String, Decodable, Sendable {
        case running, paused, completed
    }

    func elapsedMilliseconds(at date: Date) -> Double {
        guard status == .running, let runningSince else { return max(0, elapsedMs) }
        return max(0, elapsedMs) + max(0, date.timeIntervalSince(runningSince) * 1_000)
    }
}
