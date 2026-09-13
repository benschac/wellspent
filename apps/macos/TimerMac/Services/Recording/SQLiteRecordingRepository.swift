import Foundation
import GRDB
import SQLiteData

actor SQLiteRecordingRepository: RecordingRepository {
    enum Checkpoint: Sendable { case migrationWritten, beforeWrite, eventWritten, committed }

    private let requestedURL: URL?
    private let prepareDatabase: @Sendable (Database) throws -> Void
    private let checkpoint: @Sendable (Checkpoint) throws -> Void
    private var connection: DatabaseQueue?
    private var opening: (id: UUID, task: Task<DatabaseQueue, Error>)?
    private var openedURL: URL?
    private var isClosed = false

    /// Construction does no IO. Hooks allow deterministic storage/transaction fault injection.
    init(
        url: URL? = nil,
        prepareDatabase: @escaping @Sendable (Database) throws -> Void = { _ in },
        checkpoint: @escaping @Sendable (Checkpoint) throws -> Void = { _ in }
    ) {
        requestedURL = url
        self.prepareDatabase = prepareDatabase
        self.checkpoint = checkpoint
    }

    func load() async throws -> [RecordingSnapshot] {
        try await access { db in try Self.snapshots(db) }
    }

    func commit(_ event: RecordingEvent) async throws -> RecordingSnapshot {
        try event.validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let payload = String(decoding: try encoder.encode(event), as: UTF8.self)
        let checkpoint = checkpoint
        let snapshot = try await access { db in
            if let original = try RecordingEventRecord.where({ $0.id.eq(event.id.uuidString) }).fetchOne(db) {
                guard original.payload == payload else { throw RecordingError.conflictingIdentity }
                guard let saved = try Self.snapshot(db, id: event.recordingID.uuidString) else {
                    throw RecordingError.invalidStore
                }
                return saved
            }
            var snapshot: RecordingSnapshot
            try checkpoint(.beforeWrite)
            if event.kind == .start {
                // Starting is infrequent; validate all history to enforce the single unfinished recording rule.
                let all = try Self.snapshots(db)
                guard !all.contains(where: { $0.status != .finished }) else { throw RecordingError.anotherRecording }
                guard !all.contains(where: { $0.id == event.recordingID }) else {
                    throw RecordingError.conflictingIdentity
                }
                snapshot = try RecordingSnapshot.rebuild([event])
                try RecordingRecord.insert {
                    RecordingRecord(id: event.recordingID.uuidString, scope: event.localScopeID)
                }.execute(db)
            } else {
                guard let saved = try Self.snapshot(db, id: event.recordingID.uuidString) else {
                    throw RecordingError.staleInterval
                }
                snapshot = saved
                try snapshot.append(event)
            }
            try RecordingEventRecord.insert {
                RecordingEventRecord(
                    id: event.id.uuidString, recordingID: event.recordingID.uuidString,
                    sequence: snapshot.events.count, payload: payload)
            }.execute(db)
            try checkpoint(.eventWritten)
            return snapshot
        }
        // A failure here simulates a lost commit acknowledgement; retry uses the identical event.
        try checkpoint(.committed)
        return snapshot
    }

    func close() async {
        isClosed = true
        let queue: DatabaseQueue?
        if let connection {
            queue = connection
        } else {
            queue = try? await opening?.task.value
        }
        // Drain operations already submitted to GRDB before releasing the connection.
        if let queue { try? await queue.write { _ in } }
        connection = nil
        opening = nil
    }

    func delete(_ recordingID: UUID, localScopeID: String) async throws {
        try await access { db in
            guard let record = try RecordingRecord.where({ $0.id.eq(recordingID.uuidString) }).fetchOne(db),
                record.scope == localScopeID
            else { throw RecordingError.invalidStore }
            try RecordingEventRecord.where { $0.recordingID.eq(recordingID.uuidString) }.delete().execute(db)
            try RecordingRecord.where { $0.id.eq(recordingID.uuidString) }.delete().execute(db)
        }
    }

    private func access<T: Sendable>(_ body: @escaping @Sendable (Database) throws -> T) async throws -> T {
        do {
            let queue = try await database()
            guard !isClosed else { throw RecordingError.closed }
            // All domain validation and writes run in one GRDB transaction, without suspension.
            return try await queue.write(body)
        } catch let error as DatabaseError {
            throw RecordingError.storage(error.extendedResultCode.rawValue)
        }
    }

    private func database() async throws -> DatabaseQueue {
        guard !isClosed else { throw RecordingError.closed }
        if let connection, let openedURL {
            guard FileManager.default.fileExists(atPath: openedURL.path) else { throw RecordingError.invalidStore }
            return connection
        }
        let pending: (id: UUID, task: Task<DatabaseQueue, Error>)
        if let opening {
            pending = opening
        } else {
            let url: URL
            if let requestedURL {
                url = requestedURL
            } else {
                guard
                    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                else { throw RecordingError.invalidStore }
                url = support.appendingPathComponent("Wellspent/SyntheticRecording/recordings.sqlite")
            }
            let createParent = requestedURL == nil
            let prepare = prepareDatabase
            let checkpoint = checkpoint
            pending = (
                UUID(),
                Task {
                    try await Self.open(url: url, createParent: createParent, prepare: prepare, checkpoint: checkpoint)
                }
            )
            opening = pending
            openedURL = url
        }
        do {
            let queue = try await pending.task.value
            guard !isClosed else { throw RecordingError.closed }
            if opening?.id == pending.id {
                connection = queue
                opening = nil
            }
            return queue
        } catch {
            if opening?.id == pending.id { opening = nil }
            throw error
        }
    }

    @concurrent
    private static func open(
        url: URL, createParent: Bool,
        prepare: @escaping @Sendable (Database) throws -> Void,
        checkpoint: @escaping @Sendable (Checkpoint) throws -> Void
    ) async throws -> DatabaseQueue {
        if createParent {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        }
        var configuration = Configuration()
        configuration.busyMode = .timeout(0.25)
        configuration.prepareDatabase { db in
            let version = try Int.fetchOne(db, sql: "PRAGMA user_version")
            guard version == 0 || version == 1 else { throw RecordingError.unsupportedSchema }
            let applicationID = try Int.fetchOne(db, sql: "PRAGMA application_id")
            guard applicationID == 0 && version == 0 || applicationID == 1_465_078_354 else {
                throw RecordingError.invalidStore
            }
            guard try String.fetchOne(db, sql: "PRAGMA quick_check") == "ok" else {
                throw RecordingError.invalidStore
            }
            if version == 0 {
                let tables = try RecordingSchemaEntry.where {
                    $0.type.eq("table") && !$0.name.like("sqlite_%") && !$0.name.eq("grdb_migrations")
                }.fetchAll(db)
                guard tables.isEmpty else { throw RecordingError.invalidStore }
            }
            guard try Int.fetchOne(db, sql: "PRAGMA foreign_keys") == 1 else { throw RecordingError.invalidStore }
            guard try String.fetchOne(db, sql: "PRAGMA journal_mode = DELETE") == "delete" else {
                throw RecordingError.invalidStore
            }
            try db.execute(sql: "PRAGMA synchronous = EXTRA")
            try db.execute(sql: "PRAGMA fullfsync = ON")
            guard try Int.fetchOne(db, sql: "PRAGMA synchronous") == 3,
                try Int.fetchOne(db, sql: "PRAGMA fullfsync") == 1
            else { throw RecordingError.invalidStore }
            try prepare(db)
        }
        let queue = try DatabaseQueue(path: url.path, configuration: configuration)
        var migrator = DatabaseMigrator()
        migrator.registerMigration("recording-v1") { db in
            // Existing v1 recordings use the same schema and encoding. Adopt without rewriting records.
            if try Int.fetchOne(db, sql: "PRAGMA user_version") == 0 {
                try db.create(table: "recordings", options: .strict) { table in
                    table.column("id", .text).primaryKey().notNull()
                    table.column("scope", .text).notNull()
                }
                try db.create(table: "recording_events", options: .strict) { table in
                    table.column("id", .text).primaryKey().notNull()
                    table.column("recording_id", .text).notNull().references("recordings", column: "id")
                    table.column("sequence", .integer).notNull().check { $0 > 0 }
                    table.column("payload", .text).notNull()
                    table.uniqueKey(["recording_id", "sequence"])
                }
                try db.execute(sql: "PRAGMA application_id = 1465078354")
                try db.execute(sql: "PRAGMA user_version = 1")
                try checkpoint(.migrationWritten)
            }
            guard try db.foreignKeyViolations().next() == nil else {
                throw RecordingError.invalidStore
            }
            _ = try snapshots(db)
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            migrator.asyncMigrate(queue) { result in
                continuation.resume(with: result.map { _ in () })
            }
        }
        // Validate on every open, even when no migration is pending.
        try await queue.read { db in
            guard try db.foreignKeyViolations().next() == nil else {
                throw RecordingError.invalidStore
            }
            _ = try snapshots(db)
        }
        return queue
    }

    private static func snapshot(_ db: Database, id: String) throws -> RecordingSnapshot? {
        guard let record = try RecordingRecord.where({ $0.id.eq(id) }).fetchOne(db) else { return nil }
        return try rebuild(db, record: record)
    }

    private static func snapshots(_ db: Database) throws -> [RecordingSnapshot] {
        // Retain insertion ordering; UUID ordering is not creation ordering.
        let records = try RecordingRecord.order { $0.rowid.desc() }.fetchAll(db)
        return try records.map { try rebuild(db, record: $0) }
    }

    private static func rebuild(_ db: Database, record: RecordingRecord) throws -> RecordingSnapshot {
        let rows = try RecordingEventRecord.where { $0.recordingID.eq(record.id) }
            .order { $0.sequence }.fetchAll(db)
        let events = try rows.enumerated().map { index, row in
            guard row.sequence == index + 1 else { throw RecordingError.invalidStore }
            let event = try JSONDecoder().decode(RecordingEvent.self, from: Data(row.payload.utf8))
            guard event.id.uuidString == row.id, event.recordingID.uuidString == record.id,
                event.localScopeID == record.scope
            else { throw RecordingError.invalidStore }
            return event
        }
        return try RecordingSnapshot.rebuild(events)
    }
}
