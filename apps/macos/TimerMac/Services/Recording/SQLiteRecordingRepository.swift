import CryptoKit
import Foundation
import GRDB
import SQLiteData

actor SQLiteRecordingRepository: RecordingRepository {
    enum Checkpoint: Sendable {
        case migrationWritten, taskMigrationWritten, telemetryMigrationWritten, beforeWrite, eventWritten, taskWritten,
            reviewWritten, telemetryWritten, committed
    }

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
            if !event.kind.isObservation && event.kind != .interrupt,
                let intervalID = event.intervalID,
                let head = try Self.taskAttribution(db, scope: event.localScopeID)
                    .selectionHead(recordingID: event.recordingID, intervalID: intervalID),
                head.stamp.processID == event.stamp.processID,
                head.stamp.uptime > event.stamp.uptime
            {
                throw RecordingError.staleInterval
            }
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

    func loadTaskAttribution(localScopeID: String) async throws -> RecordingTaskAttribution {
        try await access { db in try Self.taskAttribution(db, scope: localScopeID) }
    }

    func createTask(_ task: LocalTask) async throws -> LocalTask {
        let checkpoint = checkpoint
        let result = try await access { db in
            try task.validate()
            let payload = try Self.reviewPayload(task)
            if let original = try LocalTaskRecord.where({
                $0.creationCommandID.eq(task.creationCommandID.uuidString) || $0.id.eq(task.id.uuidString)
            }).fetchOne(db) {
                guard original.payload == payload else { throw RecordingAttributionError.conflictingIdentity }
                return task
            }
            try checkpoint(.beforeWrite)
            try LocalTaskRecord.insert {
                LocalTaskRecord(
                    id: task.id.uuidString, scope: task.localScopeID,
                    creationCommandID: task.creationCommandID.uuidString, payload: payload)
            }.execute(db)
            try checkpoint(.taskWritten)
            return task
        }
        try checkpoint(.committed)
        return result
    }

    func selectTask(_ selection: RecordingTaskSelection) async throws -> RecordingTaskSelection {
        let checkpoint = checkpoint
        let result = try await access { db in
            // Commit order is assigned by the database, never part of the client command identity.
            var normalized = selection
            normalized.commitOrder = 0
            let payload = try Self.reviewPayload(normalized)
            if let sequence = try Self.reviewRetry(db, id: selection.id, kind: "selection", payload: payload) {
                normalized.commitOrder = sequence
                return normalized
            }
            guard !selection.author.isEmpty, selection.author.utf8.count <= 200,
                selection.stamp.wall.timeIntervalSince1970.isFinite,
                selection.stamp.uptime.isFinite, selection.stamp.uptime >= 0,
                let snapshot = try Self.snapshot(db, id: selection.recordingID.uuidString),
                snapshot.localScopeID == selection.localScopeID,
                snapshot.activeIntervalID == selection.intervalID,
                let interval = snapshot.intervals.last,
                interval.start.processID == selection.stamp.processID,
                selection.stamp.uptime >= interval.start.uptime,
                snapshot.events.filter({
                    $0.intervalID == selection.intervalID && $0.stamp.processID == selection.stamp.processID
                }).allSatisfy({ $0.stamp.uptime <= selection.stamp.uptime })
            else { throw RecordingAttributionError.invalidBoundary }
            let state = try Self.taskAttribution(db, scope: selection.localScopeID)
            try Self.validateTask(selection.taskID, state: state)
            let head = state.selectionHead(recordingID: selection.recordingID, intervalID: selection.intervalID)
            guard head?.id == selection.expectedHeadID else {
                throw RecordingAttributionError.staleHead(currentHeadID: head?.id)
            }
            guard head == nil || selection.stamp.uptime > (head?.stamp.uptime ?? 0) else {
                throw RecordingAttributionError.invalidBoundary
            }
            try checkpoint(.beforeWrite)
            normalized.commitOrder = try Self.appendReview(
                db, id: selection.id, scope: selection.localScopeID, recordingID: selection.recordingID,
                kind: "selection", payload: payload)
            try checkpoint(.reviewWritten)
            return normalized
        }
        try checkpoint(.committed)
        return result
    }

    func correctTaskAttribution(_ command: RecordingAttributionCommand) async throws -> RecordingAttributionOperation {
        let checkpoint = checkpoint
        let result = try await access { db in
            let payload = try Self.reviewPayload(command)
            // A lost acknowledgement remains successful even after later corrections supersede it.
            if let sequence = try Self.reviewRetry(db, id: command.id, kind: "attribution", payload: payload) {
                return RecordingAttributionOperation(command: command, commitOrder: sequence)
            }
            guard command.schemaVersion == 1, !command.author.isEmpty, command.author.utf8.count <= 200,
                command.createdAt.timeIntervalSince1970.isFinite
            else { throw RecordingAttributionError.invalidCommand }
            guard let snapshot = try Self.snapshot(db, id: command.recordingID.uuidString),
                snapshot.localScopeID == command.localScopeID,
                let event = snapshot.events.first(where: { $0.id == command.eventID && $0.kind.isObservation })
            else { throw RecordingAttributionError.invalidTarget }
            let state = try Self.taskAttribution(db, scope: command.localScopeID)
            try Self.validateTask(command.assignment.taskID, state: state)
            let head = state.head(eventID: command.eventID)
            guard head?.id == command.expectedHeadID else {
                throw RecordingAttributionError.staleHead(currentHeadID: head?.id)
            }
            if let undoID = command.undoesOperationID {
                guard let head, head.id == undoID,
                    state.undoCommand(for: head, at: command.createdAt).assignment == command.assignment
                else { throw RecordingAttributionError.invalidCommand }
            } else if command.assignment == .automatic && event.kind != .application {
                throw RecordingAttributionError.invalidCommand
            }
            try checkpoint(.beforeWrite)
            let sequence = try Self.appendReview(
                db, id: command.id, scope: command.localScopeID, recordingID: command.recordingID,
                kind: "attribution", payload: payload)
            try checkpoint(.reviewWritten)
            return RecordingAttributionOperation(command: command, commitOrder: sequence)
        }
        try checkpoint(.committed)
        return result
    }

    private static func reviewPayload<T: Encodable>(_ command: T) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return String(decoding: try encoder.encode(command), as: UTF8.self)
    }

    private static func reviewRetry(_ db: Database, id: UUID, kind: String, payload: String) throws -> Int64? {
        guard let original = try TaskReviewRecord.where({ $0.commandID.eq(id.uuidString) }).fetchOne(db)
        else { return nil }
        guard original.payload == payload, original.kind == kind else {
            throw RecordingAttributionError.conflictingIdentity
        }
        return original.sequence
    }

    private static func appendReview(
        _ db: Database, id: UUID, scope: String, recordingID: UUID,
        kind: String, payload: String
    ) throws -> Int64 {
        try TaskReviewRecord.insert {
            ($0.commandID, $0.scope, $0.recordingID, $0.kind, $0.schemaVersion, $0.payload)
        } values: {
            (id.uuidString, scope, recordingID.uuidString, kind, 1, payload)
        }.execute(db)
        return db.lastInsertedRowID
    }

    private static func validateTask(_ taskID: UUID?, state: RecordingTaskAttribution) throws {
        guard taskID == nil || state.tasks.contains(where: { $0.id == taskID }) else {
            throw RecordingAttributionError.invalidTarget
        }
    }

    private static func taskAttribution(_ db: Database, scope: String) throws -> RecordingTaskAttribution {
        let decoder = JSONDecoder()
        let tasks = try LocalTaskRecord.where({ $0.scope.eq(scope) }).order(by: { $0.rowid }).fetchAll(db).map { row in
            let task = try decoder.decode(LocalTask.self, from: Data(row.payload.utf8))
            guard task.id.uuidString == row.id, task.creationCommandID.uuidString == row.creationCommandID,
                task.localScopeID == scope
            else { throw RecordingError.invalidStore }
            try task.validate()
            return task
        }
        var selections: [RecordingTaskSelection] = []
        var operations: [RecordingAttributionOperation] = []
        for row in try TaskReviewRecord.where({ $0.scope.eq(scope) }).order(by: { $0.sequence }).fetchAll(db) {
            guard row.schemaVersion == 1, row.sequence > 0,
                let snapshot = try snapshot(db, id: row.recordingID), snapshot.localScopeID == scope
            else { throw RecordingError.invalidStore }
            if row.kind == "selection" {
                var selection = try decoder.decode(RecordingTaskSelection.self, from: Data(row.payload.utf8))
                guard selection.id.uuidString == row.commandID, selection.recordingID.uuidString == row.recordingID,
                    selection.localScopeID == scope, selection.commitOrder == 0,
                    let interval = snapshot.intervals.first(where: { $0.id == selection.intervalID }),
                    selection.taskID == nil || tasks.contains(where: { $0.id == selection.taskID }),
                    !selection.author.isEmpty, selection.author.utf8.count <= 200,
                    selection.stamp.wall.timeIntervalSince1970.isFinite, selection.stamp.uptime.isFinite,
                    selection.stamp.processID == interval.start.processID,
                    selection.stamp.uptime >= interval.start.uptime,
                    interval.end.map({ selection.stamp.uptime <= $0.uptime }) ?? true
                else { throw RecordingError.invalidStore }
                let head = selections.last {
                    $0.recordingID == selection.recordingID && $0.intervalID == selection.intervalID
                }
                guard head?.id == selection.expectedHeadID,
                    head.map({ selection.stamp.uptime > $0.stamp.uptime }) ?? true
                else { throw RecordingError.invalidStore }
                selection.commitOrder = row.sequence
                selections.append(selection)
            } else if row.kind == "attribution" {
                let command = try decoder.decode(RecordingAttributionCommand.self, from: Data(row.payload.utf8))
                guard command.id.uuidString == row.commandID, command.recordingID.uuidString == row.recordingID,
                    command.localScopeID == scope, command.schemaVersion == 1,
                    let event = snapshot.events.first(where: { $0.id == command.eventID && $0.kind.isObservation }),
                    command.assignment.taskID == nil || tasks.contains(where: { $0.id == command.assignment.taskID }),
                    !command.author.isEmpty, command.author.utf8.count <= 200,
                    command.createdAt.timeIntervalSince1970.isFinite
                else { throw RecordingError.invalidStore }
                let state = RecordingTaskAttribution(tasks: tasks, selections: selections, operations: operations)
                let head = state.head(eventID: command.eventID)
                guard head?.id == command.expectedHeadID else { throw RecordingError.invalidStore }
                if let undoID = command.undoesOperationID {
                    guard let head, head.id == undoID,
                        state.undoCommand(for: head, at: command.createdAt).assignment == command.assignment
                    else { throw RecordingError.invalidStore }
                } else if command.assignment == .automatic && event.kind != .application {
                    throw RecordingError.invalidStore
                }
                operations.append(.init(command: command, commitOrder: row.sequence))
            } else {
                throw RecordingError.invalidStore
            }
        }
        return RecordingTaskAttribution(tasks: tasks, selections: selections, operations: operations)
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
            try CodexGrantRecord.where { $0.recordingID.eq(recordingID.uuidString) }
                .update { $0.revoked = 1 }.execute(db)
            try TaskReviewRecord.where { $0.recordingID.eq(recordingID.uuidString) }.delete().execute(db)
            try CodexTelemetryRecord.where { $0.recordingID.eq(recordingID.uuidString) }.delete().execute(db)
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
                (try CodexGrantRecord.where({ $0.revoked.eq(0) }).count().fetchOne(db) ?? 0) < 256
            else { throw CodexIntakeContract.Failure.invalidAssociation }
            try CodexGrantRecord.insert {
                CodexGrantRecord(
                    id: grant.binding.bindingID.uuidString, recordingID: recordingID.uuidString,
                    payload: payload, revoked: 0)
            }.execute(db)
        }
        return CodexIntakeContract.PairingBundle(grant: grant)
    }

    func codexGrants() async throws -> [CodexIntakeContract.Grant] {
        try await access { db in
            try CodexGrantRecord.fetchAll(db).map { try Self.codexGrant($0) }
        }
    }

    func revokeCodexGrant(bindingID: UUID) async throws {
        try await access { db in
            guard try Self.codexGrant(db, id: bindingID) != nil else {
                throw CodexIntakeContract.Failure.untrustedSender
            }
            try CodexGrantRecord.where { $0.id.eq(bindingID.uuidString) }
                .update { $0.revoked = 1 }.execute(db)
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

    func receiveCodexTelemetry(
        _ packet: CodexIntakeContract.Packet, bindingID: UUID, stamp: RecordingEvent.Stamp
    ) async throws -> CodexIntakeContract.Packet {
        let checkpoint = checkpoint
        let committed = try await access { db -> (Data, Data) in
            guard let grant = try Self.codexGrant(db, id: bindingID) else {
                throw CodexTelemetryContract.Failure.untrustedSender
            }
            let metadata = try CodexTelemetryContract.decode(packet, grant: grant)
            if let original = try CodexTelemetryRecord.where({ $0.id.eq(metadata.observationID.uuidString) })
                .fetchOne(db)
            {
                guard original.body == packet.body else { throw CodexTelemetryContract.Failure.identityConflict }
                return (original.receipt, grant.key)
            }
            let source = try CodexIntakeContract.date(metadata.sourceWrittenAt)
            let helper = try CodexIntakeContract.date(metadata.helperReceivedAt)
            guard stamp.wall <= grant.acceptUntil else { throw CodexTelemetryContract.Failure.expiredBinding }
            guard let snapshot = try Self.snapshot(db, id: metadata.recordingID.uuidString),
                snapshot.localScopeID == metadata.localScopeID,
                let interval = snapshot.intervals.first(where: { $0.id == metadata.intervalID }),
                grant.issuedAt >= interval.start.wall, source >= grant.issuedAt,
                helper >= source, helper <= stamp.wall
            else { throw CodexTelemetryContract.Failure.invalidAssociation }
            guard !interval.interrupted else { throw CodexTelemetryContract.Failure.interruptedInterval }
            guard let end = interval.end else { throw CodexTelemetryContract.Failure.awaitingIntervalEnd }
            guard grant.issuedAt < end.wall, source < end.wall else {
                throw CodexTelemetryContract.Failure.outsideInterval
            }
            let receipt = CodexTelemetryContract.Receipt(
                observationID: metadata.observationID,
                bodyDigest: CodexIntakeContract.digest(packet.body),
                nativeReceivedAt: CodexIntakeContract.timestamp(stamp.wall))
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let body = try encoder.encode(receipt)
            try checkpoint(.beforeWrite)
            try CodexTelemetryRecord.insert {
                CodexTelemetryRecord(
                    id: metadata.observationID.uuidString, bindingID: bindingID.uuidString,
                    recordingID: metadata.recordingID.uuidString, scope: metadata.localScopeID,
                    kind: metadata.kind, body: packet.body, receipt: body)
            }.execute(db)
            try checkpoint(.telemetryWritten)
            return (body, grant.key)
        }
        try checkpoint(.committed)
        return CodexIntakeContract.sign(committed.0, key: committed.1, domain: "telemetry-ack")
    }

    func loadCodexTelemetry(localScopeID: String) async throws -> [CodexTelemetryContract.Metadata] {
        try await access { db in
            try CodexTelemetryRecord.where({ $0.scope.eq(localScopeID) }).order(by: { $0.rowid }).fetchAll(db)
                .map { row in
                    let metadata = try CodexTelemetryContract.parse(row.body)
                    guard metadata.observationID.uuidString == row.id else { throw RecordingError.invalidStore }
                    return metadata
                }
        }
    }

    func loadCodexTelemetryReview(localScopeID: String, recordingID: UUID, intervalID: UUID) async throws
        -> [RecordingTelemetryObservation]
    {
        try await access { db in
            let rows = try CodexTelemetryRecord.where {
                $0.scope.eq(localScopeID) && $0.recordingID.eq(recordingID.uuidString)
            }.fetchAll(db)
            return try rows.map { row in
                let observation = try RecordingTelemetryObservation(body: row.body, receipt: row.receipt)
                guard observation.id.uuidString == row.id,
                    observation.metadata.localScopeID == localScopeID,
                    observation.metadata.recordingID == recordingID
                else { throw RecordingError.invalidStore }
                return observation
            }.filter { $0.metadata.intervalID == intervalID }
                .sorted {
                    if $0.sourceWrittenAt != $1.sourceWrittenAt { return $0.sourceWrittenAt < $1.sourceWrittenAt }
                    return $0.id.uuidString < $1.id.uuidString
                }
        }
    }

    private static func codexGrant(_ db: Database, id: UUID) throws -> CodexIntakeContract.Grant? {
        guard let row = try CodexGrantRecord.where({ $0.id.eq(id.uuidString) }).fetchOne(db)
        else { return nil }
        return try codexGrant(row)
    }

    private static func codexGrant(_ row: CodexGrantRecord) throws -> CodexIntakeContract.Grant {
        var grant = try JSONDecoder().decode(CodexIntakeContract.Grant.self, from: row.payload)
        guard grant.binding.bindingID.uuidString == row.id, grant.binding.recordingID.uuidString == row.recordingID,
            grant.key.count == 32, grant.revoked == false, row.revoked == 0 || row.revoked == 1,
            !grant.binding.localScopeID.isEmpty, grant.binding.localScopeID.utf8.count <= 200,
            CodexIntakeContract.validEndpoint(grant.endpoint),
            CodexIntakeContract.validID(grant.binding.senderID), CodexIntakeContract.validID(grant.binding.threadID),
            grant.acceptUntil.timeIntervalSince(grant.issuedAt) == 7 * 24 * 60 * 60
        else { throw RecordingError.invalidStore }
        grant.revoked = row.revoked == 1
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
            guard version == 0 || version == 1 || version == 2 || version == 3 else {
                throw RecordingError.unsupportedSchema
            }
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
        migrator.registerMigration("local-task-attribution-v2") { db in
            try db.create(table: "local_tasks", options: .strict) { table in
                table.column("id", .text).primaryKey().notNull()
                table.column("scope", .text).notNull()
                table.column("creation_command_id", .text).unique().notNull()
                table.column("payload", .text).notNull()
            }
            try db.create(table: "task_review_operations", options: .strict) { table in
                table.autoIncrementedPrimaryKey("sequence")
                table.column("command_id", .text).unique().notNull()
                table.column("scope", .text).notNull()
                table.column("recording_id", .text).notNull().references("recordings", column: "id")
                table.column("kind", .text).notNull().check { $0 == "selection" || $0 == "attribution" }
                table.column("schema_version", .integer).notNull().check { $0 == 1 }
                table.column("payload", .text).notNull()
            }
            try db.create(
                index: "task_review_recording", on: "task_review_operations", columns: ["recording_id", "sequence"])
            try db.create(index: "task_review_scope", on: "task_review_operations", columns: ["scope", "sequence"])
            try db.execute(sql: "PRAGMA user_version = 2")
            try checkpoint(.taskMigrationWritten)
        }
        migrator.registerMigration("codex-telemetry-v3") { db in
            try db.create(table: "codex_telemetry", options: .strict) { table in
                table.column("id", .text).primaryKey().notNull()
                table.column("binding_id", .text).notNull().references("codex_grants", column: "id")
                table.column("recording_id", .text).notNull().references("recordings", column: "id")
                table.column("scope", .text).notNull()
                table.column("kind", .text).notNull().check { $0 == "turnConfiguration" || $0 == "responseUsage" }
                table.column("body", .blob).notNull()
                table.column("receipt", .blob).notNull()
            }
            try db.create(index: "codex_telemetry_scope", on: "codex_telemetry", columns: ["scope", "recording_id"])
            try db.execute(sql: "PRAGMA user_version = 3")
            try checkpoint(.telemetryMigrationWritten)
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
            let recordings = try snapshots(db)
            let scopes = Set(recordings.map(\.localScopeID))
                .union(try LocalTaskRecord.fetchAll(db).map(\.scope))
            for scope in scopes { _ = try taskAttribution(db, scope: scope) }
            let telemetry = try CodexTelemetryRecord.fetchAll(db)
            for row in telemetry {
                let metadata = try CodexTelemetryContract.parse(row.body)
                let saved = try JSONDecoder().decode(CodexTelemetryContract.Receipt.self, from: row.receipt)
                guard metadata.observationID.uuidString == row.id, metadata.localScopeID == row.scope,
                    metadata.recordingID.uuidString == row.recordingID, metadata.kind == row.kind,
                    saved.observationID == metadata.observationID,
                    saved.bodyDigest == CodexIntakeContract.digest(row.body)
                else { throw RecordingError.invalidStore }
            }
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
