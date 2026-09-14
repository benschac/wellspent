import CryptoKit
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
        let checkpoint = checkpoint
        let snapshot = try await access { db in try Self.commit(event, in: db, checkpoint: checkpoint) }
        // A failure here simulates a lost commit acknowledgement; retry uses the identical event.
        try checkpoint(.committed)
        return snapshot
    }

    private static func commit(
        _ event: RecordingEvent, in db: Database,
        checkpoint: @Sendable (Checkpoint) throws -> Void
    ) throws -> RecordingSnapshot {
        try event.validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let payload = String(decoding: try encoder.encode(event), as: UTF8.self)
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
            try db.execute(
                sql: "UPDATE codex_grants SET revoked = 1 WHERE recording_id = ?", arguments: [recordingID.uuidString])
            try RecordingEventRecord.where { $0.recordingID.eq(recordingID.uuidString) }.delete().execute(db)
            try RecordingRecord.where { $0.id.eq(recordingID.uuidString) }.delete().execute(db)
        }
    }

    func issueCodexGrant(
        senderID: String, threadID: String, recordingID: UUID, localScopeID: String,
        intervalID: UUID, issuedAt: Date, endpoint: String
    ) async throws -> CodexIntakeContract.PairingBundle {
        guard CodexIntakeContract.validID(senderID), CodexIntakeContract.validID(threadID),
            CodexIntakeContract.validEndpoint(endpoint), issuedAt.timeIntervalSince1970.isFinite
        else { throw CodexIntakeContract.Failure.invalidAssociation }
        // The helper sees millisecond timestamps. Round upward when necessary so the durable
        // grant and displayed bundle agree without authorizing a fraction of a prior millisecond.
        let canonical = try CodexIntakeContract.date(CodexIntakeContract.timestamp(issuedAt))
        let durableIssuedAt =
            canonical < issuedAt
            ? try CodexIntakeContract.date(CodexIntakeContract.timestamp(issuedAt.addingTimeInterval(0.001)))
            : canonical
        let key = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
        let grant = CodexIntakeContract.Grant(
            binding: .init(
                bindingID: UUID(), senderID: senderID, localScopeID: localScopeID,
                recordingID: recordingID, intervalID: intervalID, threadID: threadID),
            key: key, issuedAt: durableIssuedAt, acceptUntil: durableIssuedAt.addingTimeInterval(7 * 24 * 60 * 60),
            endpoint: endpoint)
        let payload = try JSONEncoder().encode(grant)
        try await access { db in
            guard let snapshot = try Self.snapshot(db, id: recordingID.uuidString),
                snapshot.localScopeID == localScopeID, snapshot.activeIntervalID == intervalID,
                let interval = snapshot.intervals.last, issuedAt >= interval.start.wall,
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM codex_grants WHERE revoked = 0") ?? 0 < 256
            else { throw CodexIntakeContract.Failure.invalidAssociation }
            try db.execute(
                sql: "INSERT INTO codex_grants (id, recording_id, payload, revoked) VALUES (?, ?, ?, 0)",
                arguments: [grant.binding.bindingID.uuidString, recordingID.uuidString, payload])
        }
        return CodexIntakeContract.PairingBundle(grant: grant)
    }

    func codexGrants() async throws -> [CodexIntakeContract.Grant] {
        try await access { db in
            try Row.fetchAll(db, sql: "SELECT id, recording_id, payload, revoked FROM codex_grants")
                .map { try Self.codexGrant($0) }
        }
    }

    func revokeCodexGrant(bindingID: UUID) async throws {
        try await access { db in
            guard try Self.codexGrant(db, id: bindingID) != nil else {
                throw CodexIntakeContract.Failure.untrustedSender
            }
            try db.execute(sql: "UPDATE codex_grants SET revoked = 1 WHERE id = ?", arguments: [bindingID.uuidString])
        }
    }

    /// Authentication, association, identity checks, event commit and revocation use one SQLite
    /// transaction. No actor suspension can let revocation race a successful new intake commit.
    func receiveCodexPacket(
        _ packet: CodexIntakeContract.Packet, bindingID: UUID, stamp: RecordingEvent.Stamp
    ) async throws -> CodexIntakeContract.Packet {
        let checkpoint = checkpoint
        let committed: (RecordingEvent, CodexIntakeContract.Grant) = try await access { db in
            guard let grant = try Self.codexGrant(db, id: bindingID) else {
                throw CodexIntakeContract.Failure.untrustedSender
            }
            let metadata = try CodexIntakeContract.decode(packet, grant: grant)
            let hookTime = try CodexIntakeContract.date(metadata.hookReceivedAt)
            if let row = try RecordingEventRecord.where({ $0.id.eq(metadata.eventID.uuidString) }).fetchOne(db) {
                let original = try JSONDecoder().decode(RecordingEvent.self, from: Data(row.payload.utf8))
                guard original.agentMetadata?.exactBody == packet.body else {
                    throw CodexIntakeContract.Failure.identityConflict
                }
                _ = try Self.commit(original, in: db, checkpoint: checkpoint)
                return (original, grant)
            }
            guard stamp.wall <= grant.acceptUntil else { throw CodexIntakeContract.Failure.expiredBinding }
            guard let snapshot = try Self.snapshot(db, id: metadata.recordingID.uuidString),
                snapshot.localScopeID == metadata.localScopeID,
                let interval = snapshot.intervals.first(where: { $0.id == metadata.intervalID }),
                grant.issuedAt >= interval.start.wall, hookTime >= grant.issuedAt,
                hookTime >= interval.start.wall, hookTime <= stamp.wall
            else { throw CodexIntakeContract.Failure.invalidAssociation }
            guard !interval.interrupted else { throw CodexIntakeContract.Failure.interruptedInterval }
            guard let end = interval.end else { throw CodexIntakeContract.Failure.awaitingIntervalEnd }
            guard end.wall >= interval.start.wall, grant.issuedAt < end.wall, hookTime < end.wall else {
                throw CodexIntakeContract.Failure.outsideInterval
            }
            let event = RecordingEvent(
                id: metadata.eventID, localScopeID: metadata.localScopeID, recordingID: metadata.recordingID,
                intervalID: metadata.intervalID, kind: .agentCompletion, stamp: stamp, timeBasis: .hookReceived,
                agentMetadata: CodexAgentMetadata(
                    metadata: metadata, exactBody: packet.body,
                    bodyDigest: CodexIntakeContract.digest(packet.body)))
            _ = try Self.commit(event, in: db, checkpoint: checkpoint)
            return (event, grant)
        }
        // Commit has returned successfully. Failure here models a lost acknowledgement after commit.
        try checkpoint(.committed)
        let receipt = CodexIntakeContract.Receipt(
            eventID: committed.0.id,
            bodyDigest: CodexIntakeContract.digest(packet.body),
            nativeReceivedAt: CodexIntakeContract.timestamp(committed.0.stamp.wall))
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return CodexIntakeContract.sign(try encoder.encode(receipt), key: committed.1.key, domain: "ack")
    }

    private static func codexGrant(_ db: Database, id: UUID) throws -> CodexIntakeContract.Grant? {
        guard
            let row = try Row.fetchOne(
                db,
                sql: "SELECT id, recording_id, payload, revoked FROM codex_grants WHERE id = ?",
                arguments: [id.uuidString])
        else { return nil }
        return try codexGrant(row)
    }

    private static func codexGrant(_ row: Row) throws -> CodexIntakeContract.Grant {
        let payload: Data = row["payload"]
        let id: String = row["id"]
        let recordingID: String = row["recording_id"]
        let revoked: Int = row["revoked"]
        var grant = try JSONDecoder().decode(CodexIntakeContract.Grant.self, from: payload)
        guard grant.binding.bindingID.uuidString == id, grant.binding.recordingID.uuidString == recordingID,
            grant.key.count == 32, grant.revoked == false, revoked == 0 || revoked == 1,
            !grant.binding.localScopeID.isEmpty, grant.binding.localScopeID.utf8.count <= 200,
            CodexIntakeContract.validEndpoint(grant.endpoint),
            CodexIntakeContract.validID(grant.binding.senderID), CodexIntakeContract.validID(grant.binding.threadID),
            grant.acceptUntil.timeIntervalSince(grant.issuedAt) == 7 * 24 * 60 * 60
        else { throw RecordingError.invalidStore }
        grant.revoked = revoked == 1
        return grant
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
        migrator.registerMigration("codex-local-grants-v1") { db in
            try db.create(table: "codex_grants", options: .strict) { table in
                table.column("id", .text).primaryKey().notNull()
                // Retain revocation after recording deletion. This intentionally has no cascading FK.
                table.column("recording_id", .text).notNull()
                table.column("payload", .blob).notNull()
                table.column("revoked", .integer).notNull().defaults(to: 0).check { $0 == 0 || $0 == 1 }
            }
        }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700], ofItemAtPath: url.deletingLastPathComponent().path)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
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
