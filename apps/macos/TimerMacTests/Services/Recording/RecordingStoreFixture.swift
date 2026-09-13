import Foundation
import GRDB
import SQLiteData

@testable import TimerMac

struct RecordingStoreFixture {
    let directory: URL
    var url: URL { directory.appendingPathComponent("recordings.sqlite") }
    let recordingID = UUID()
    let intervalID = UUID()
    let processID = UUID()

    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("RecordingTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    }

    func remove() { try? FileManager.default.removeItem(at: directory) }

    func event(
        _ kind: RecordingEvent.Kind, at seconds: TimeInterval = 0, id: UUID = UUID(),
        interval: UUID? = nil, scope: String = "local", text: String = "",
        occurredAt: Date? = nil
    ) -> RecordingEvent {
        RecordingEvent(
            id: id, localScopeID: scope, recordingID: recordingID, intervalID: interval ?? intervalID,
            kind: kind,
            stamp: .init(
                wall: Date(timeIntervalSince1970: 1_800_000_000 + seconds), uptime: 100 + seconds, processID: processID),
            occurredAt: occurredAt, timeBasis: occurredAt == nil ? .receiver : .sourceReported, text: text)
    }

    // Each connection remains local to this synchronous call and closes before actor operations.
    func sql(_ statement: String) throws -> [[String]] {
        let database = try DatabaseQueue(path: url.path)
        defer { try? database.close() }
        return try database.writeWithoutTransaction { db in
            try Row.fetchAll(db, sql: statement).map { row in
                try row.map { _, value in
                    switch value.storage {
                    case .string(let text): return text
                    case .int64(let number): return String(number)
                    case .double(let number): return String(number)
                    case .null: return ""
                    case .blob: throw RecordingError.invalidStore
                    }
                }
            }
        }
    }
}

enum RecordingInjectedFailure: Error { case checkpoint }
