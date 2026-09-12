import Foundation

actor SQLiteRecordingRepository: RecordingRepository {
    enum Checkpoint: Sendable { case migrationWritten, beforeWrite, eventWritten, committed }

    nonisolated let executor = RecordingDatabaseExecutor()
    nonisolated var unownedExecutor: UnownedSerialExecutor { executor.asUnownedSerialExecutor() }
    private let requestedURL: URL?
    private let openConnection: @Sendable (URL) throws -> RecordingSQLiteConnection
    private let checkpoint: @Sendable (Checkpoint) throws -> Void
    private var connection: RecordingSQLiteConnection?
    private var openedURL: URL?
    private var isClosed = false

    /// Construction does no IO. The hook is for deterministic transaction/crash fault injection.
    init(
        url: URL? = nil,
        openConnection: @escaping @Sendable (URL) throws -> RecordingSQLiteConnection = {
            try RecordingSQLiteConnection(url: $0)
        },
        checkpoint: @escaping @Sendable (Checkpoint) throws -> Void = { _ in }
    ) {
        requestedURL = url
        self.openConnection = openConnection
        self.checkpoint = checkpoint
    }

    func load() throws -> [RecordingSnapshot] {
        let db = try database()
        return try transaction(db) { try snapshots(db) }
    }

    func commit(_ event: RecordingEvent) throws -> RecordingSnapshot {
        try event.validate()
        let db = try database()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let payload = String(decoding: try encoder.encode(event), as: UTF8.self)
        let snapshot = try transaction(db) {
            if let original = try db.rows("SELECT payload FROM recording_events WHERE id = ?", [event.id.uuidString])
                .first?.first
            {
                guard original == payload else { throw RecordingError.conflictingIdentity }
                guard let saved = try snapshots(db).first(where: { $0.id == event.recordingID }) else {
                    throw RecordingError.invalidStore
                }
                return saved
            }
            let all = try snapshots(db)
            var snapshot: RecordingSnapshot
            try checkpoint(.beforeWrite)
            if event.kind == .start {
                guard !all.contains(where: { $0.status != .finished }) else { throw RecordingError.anotherRecording }
                guard !all.contains(where: { $0.id == event.recordingID }) else {
                    throw RecordingError.conflictingIdentity
                }
                snapshot = try RecordingSnapshot.rebuild([event])
                try db.execute(
                    "INSERT INTO recordings (id, scope) VALUES (?, ?)",
                    [event.recordingID.uuidString, event.localScopeID])
            } else {
                guard let saved = all.first(where: { $0.id == event.recordingID }) else {
                    throw RecordingError.staleInterval
                }
                snapshot = saved
                try snapshot.append(event)
            }
            try db.execute(
                "INSERT INTO recording_events (id, recording_id, sequence, payload) VALUES (?, ?, ?, ?)",
                [event.id.uuidString, event.recordingID.uuidString, String(snapshot.events.count), payload])
            try checkpoint(.eventWritten)
            return snapshot
        }
        // A failure here simulates a lost commit acknowledgement; retry uses the identical event.
        try checkpoint(.committed)
        return snapshot
    }

    func close() {
        isClosed = true
        connection = nil
    }

    private func database() throws -> RecordingSQLiteConnection {
        guard !isClosed else { throw RecordingError.closed }
        if let connection, let openedURL {
            guard FileManager.default.fileExists(atPath: openedURL.path) else { throw RecordingError.invalidStore }
            return connection
        }
        let url: URL
        if let requestedURL {
            url = requestedURL
        } else {
            guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            else {
                throw RecordingError.invalidStore
            }
            let directory = support.appendingPathComponent("Wellspent/SyntheticRecording", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            url = directory.appendingPathComponent("recordings.sqlite")
        }
        let db = try openConnection(url)
        let version = try db.scalar("PRAGMA user_version")
        guard version == "0" || version == "1" else { throw RecordingError.unsupportedSchema }
        let applicationID = try db.scalar("PRAGMA application_id")
        guard applicationID == "0" && version == "0" || applicationID == "1465078354" else {
            throw RecordingError.invalidStore
        }
        guard try db.scalar("PRAGMA quick_check") == "ok" else { throw RecordingError.invalidStore }
        try db.execute("PRAGMA foreign_keys = ON")
        guard try db.scalar("PRAGMA foreign_keys") == "1" else { throw RecordingError.invalidStore }
        guard try db.scalar("PRAGMA journal_mode = DELETE") == "delete" else { throw RecordingError.invalidStore }
        try db.execute("PRAGMA synchronous = EXTRA")
        try db.execute("PRAGMA fullfsync = ON")
        guard try db.scalar("PRAGMA synchronous") == "3", try db.scalar("PRAGMA fullfsync") == "1" else {
            throw RecordingError.invalidStore
        }
        if version == "0" {
            guard
                try db.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").isEmpty
            else {
                throw RecordingError.invalidStore
            }
            try db.execute("BEGIN IMMEDIATE")
            do {
                try db.execute("CREATE TABLE recordings (id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL) STRICT")
                try db.execute(
                    """
                    CREATE TABLE recording_events (
                        id TEXT PRIMARY KEY NOT NULL,
                        recording_id TEXT NOT NULL REFERENCES recordings(id),
                        sequence INTEGER NOT NULL CHECK(sequence > 0),
                        payload TEXT NOT NULL,
                        UNIQUE(recording_id, sequence)
                    ) STRICT
                    """)
                try db.execute("PRAGMA application_id = 1465078354")
                try db.execute("PRAGMA user_version = 1")
                try checkpoint(.migrationWritten)
                try db.execute("COMMIT")
            } catch {
                try? db.execute("ROLLBACK")
                throw error
            }
        }
        guard try db.rows("PRAGMA foreign_key_check").isEmpty else { throw RecordingError.invalidStore }
        _ = try snapshots(db)
        openedURL = url
        connection = db
        return db
    }

    private func snapshots(_ db: RecordingSQLiteConnection) throws -> [RecordingSnapshot] {
        let records = try db.rows("SELECT id, scope FROM recordings ORDER BY rowid DESC")
        return try records.map { record in
            guard record.count == 2 else { throw RecordingError.invalidStore }
            let rows = try db.rows(
                "SELECT id, sequence, payload FROM recording_events WHERE recording_id = ? ORDER BY sequence",
                [record[0]])
            let events = try rows.enumerated().map { index, row in
                guard row.count == 3, row[1] == String(index + 1) else { throw RecordingError.invalidStore }
                let event = try JSONDecoder().decode(RecordingEvent.self, from: Data(row[2].utf8))
                guard event.id.uuidString == row[0], event.recordingID.uuidString == record[0],
                    event.localScopeID == record[1]
                else {
                    throw RecordingError.invalidStore
                }
                return event
            }
            return try RecordingSnapshot.rebuild(events)
        }
    }

    private func transaction<T>(_ db: RecordingSQLiteConnection, _ body: () throws -> T) throws -> T {
        try db.execute("BEGIN IMMEDIATE")
        do {
            let result = try body()
            try db.execute("COMMIT")
            return result
        } catch {
            try? db.execute("ROLLBACK")
            throw error
        }
    }
}
