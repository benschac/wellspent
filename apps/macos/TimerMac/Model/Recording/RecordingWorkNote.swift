import Foundation

/// Selected text submitted via log_work. Original authenticated bytes survive retries unchanged.
struct RecordingWorkNote: Codable, Equatable, Sendable {
    let exactBody: Data
    let bodyDigest: String

    var reportedAt: Date? {
        guard let note = try? LocalHarnessContract.parseNote(exactBody) else { return nil }
        return try? CodexIntakeContract.date(note.reportedAt)
    }

    func validate(event: RecordingEvent) throws {
        let note = try LocalHarnessContract.parseNote(exactBody)
        guard bodyDigest == CodexIntakeContract.digest(exactBody), event.id == note.eventID,
            event.kind == .note, event.timeBasis == .receiver, event.occurredAt == nil,
            event.localScopeID == note.localScopeID, event.recordingID == note.recordingID,
            event.intervalID == note.intervalID, event.text == note.text
        else { throw RecordingError.invalidEvent }
    }
}
