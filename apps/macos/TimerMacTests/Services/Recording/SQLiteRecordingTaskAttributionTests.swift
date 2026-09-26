import Foundation
import Testing

@testable import TimerMac

struct SQLiteRecordingTaskAttributionTests {
    @Test
    func tasksSpanFinishedRecordingsAndCorrectionsUndoWithoutChangingOriginals() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let taskA = task(fixture, title: "A")
        let taskB = task(fixture, title: "B")
        #expect(try await repository.createTask(taskA) == taskA)
        #expect(try await repository.createTask(taskA) == taskA)
        _ = try await repository.createTask(taskB)
        let first = fixture.event(.application, at: 2, text: "Original observation")
        for event in [fixture.event(.start), first, fixture.event(.finish, at: 10)] {
            _ = try await repository.commit(event)
        }
        let secondID = UUID()
        let secondInterval = UUID()
        let secondEvents = [RecordingEvent.Kind.start, .note, .finish].enumerated().map { index, kind in
            RecordingEvent(
                localScopeID: "local", recordingID: secondID, intervalID: secondInterval,
                kind: kind, stamp: fixture.event(kind, at: Double(20 + index)).stamp,
                text: kind == .note ? "Original user note" : "")
        }
        for event in secondEvents { _ = try await repository.commit(event) }
        let second = try #require(secondEvents.first { $0.kind == .note })
        let before = try fixture.sql("SELECT payload FROM recording_events ORDER BY rowid")
        let c1 = correction(first, assignment: .task(taskA.id))
        let op1 = try await repository.correctTaskAttribution(c1)
        let secondOp = try await repository.correctTaskAttribution(correction(second, assignment: .task(taskA.id)))
        let c2 = correction(first, assignment: .task(taskB.id), head: op1.id)
        let op2 = try await repository.correctTaskAttribution(c2)
        // A retry of c1 remains successful after c2, despite the now-stale expected head.
        #expect(try await repository.correctTaskAttribution(c1) == op1)
        let state = try await repository.loadTaskAttribution(localScopeID: "local")
        let undo = state.undoCommand(for: op2, at: first.stamp.wall.addingTimeInterval(100))
        let undone = try await repository.correctTaskAttribution(undo)
        #expect(undone.commitOrder > op2.commitOrder)
        #expect(undone.command.undoesOperationID == op2.id)
        #expect(undone.command.expectedHeadID == op2.id)
        #expect(try fixture.sql("SELECT payload FROM recording_events ORDER BY rowid") == before)
        let savedState = try await repository.loadTaskAttribution(localScopeID: "local")
        #expect(savedState.taskID(for: first) == taskA.id)
        #expect(savedState.taskID(for: second) == taskA.id)
        #expect(savedState.operations.count == 4)
        #expect(savedState.head(eventID: second.id) == secondOp)
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await reopened.loadTaskAttribution(localScopeID: "local") == savedState)
        #expect(try await reopened.load().allSatisfy { $0.status == .finished })
        #expect(try fixture.sql("SELECT payload FROM recording_events ORDER BY rowid") == before)
        await reopened.close()
    }

    @Test
    func twoRepositoriesDetectStaleHeadAndChangedCommandIdentity() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let first = SQLiteRecordingRepository(url: fixture.url)
        _ = try await first.commit(fixture.event(.start))
        let evidence = fixture.event(.note, at: 2)
        _ = try await first.commit(evidence)
        _ = try await first.commit(fixture.event(.finish, at: 3))
        let second = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await second.loadTaskAttribution(localScopeID: "local").head(eventID: evidence.id) == nil)
        let command = correction(evidence, assignment: .unassigned)
        let saved = try await first.correctTaskAttribution(command)
        await #expect(throws: RecordingAttributionError.staleHead(currentHeadID: saved.id)) {
            try await second.correctTaskAttribution(correction(evidence, assignment: .unassigned))
        }
        let changed = RecordingAttributionCommand(
            id: command.id, localScopeID: command.localScopeID, recordingID: command.recordingID,
            eventID: command.eventID, assignment: .unassigned, createdAt: command.createdAt.addingTimeInterval(1))
        await #expect(throws: RecordingAttributionError.conflictingIdentity) {
            try await second.correctTaskAttribution(changed)
        }
        #expect(try await second.correctTaskAttribution(command) == saved)
        let state = try await first.loadTaskAttribution(localScopeID: "local")
        let undo = state.undoCommand(for: saved, at: evidence.stamp.wall.addingTimeInterval(20))
        _ = try await first.correctTaskAttribution(correction(evidence, assignment: .unassigned, head: saved.id))
        await #expect(throws: RecordingAttributionError.self) { try await second.correctTaskAttribution(undo) }
        #expect(try await second.loadTaskAttribution(localScopeID: "local").operations.count == 2)
        await first.close()
        await second.close()
    }

    @Test(arguments: ["beforeWrite", "reviewWritten", "committed"])
    func correctionFailuresRollbackOrRecoverOriginalCommitAfterLostAcknowledgement(phase: String) async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let initial = SQLiteRecordingRepository(url: fixture.url)
        _ = try await initial.commit(fixture.event(.start))
        let evidence = fixture.event(.note, at: 1)
        _ = try await initial.commit(evidence)
        _ = try await initial.commit(fixture.event(.finish, at: 2))
        await initial.close()
        let repository = SQLiteRecordingRepository(
            url: fixture.url,
            checkpoint: { point in
                if (phase == "beforeWrite" && point == .beforeWrite)
                    || (phase == "reviewWritten" && point == .reviewWritten)
                    || (phase == "committed" && point == .committed)
                {
                    throw RecordingInjectedFailure.checkpoint
                }
            })
        let command = correction(evidence, assignment: .unassigned)
        await #expect(throws: RecordingInjectedFailure.self) { try await repository.correctTaskAttribution(command) }
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(
            try await reopened.loadTaskAttribution(localScopeID: "local").operations.count
                == (phase == "committed" ? 1 : 0))
        let saved = try await reopened.correctTaskAttribution(command)
        #expect(try await reopened.correctTaskAttribution(command) == saved)
        #expect(try await reopened.loadTaskAttribution(localScopeID: "local").operations.count == 1)
        await reopened.close()
    }

    @Test
    func selectionsSplitForegroundOnlyAndUndoRestoresBoundaryProjection() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let taskA = task(fixture, title: "A")
        let taskB = task(fixture, title: "B")
        _ = try await repository.createTask(taskA)
        _ = try await repository.createTask(taskB)
        _ = try await repository.commit(fixture.event(.start))
        let app = fixture.event(.application)
        _ = try await repository.commit(app)
        let a = try await repository.selectTask(selection(fixture, taskID: taskA.id, at: 1))
        let b = try await repository.selectTask(selection(fixture, taskID: taskB.id, at: 10, head: a.id))
        await #expect(throws: RecordingAttributionError.staleHead(currentHeadID: b.id)) {
            try await repository.selectTask(selection(fixture, taskID: taskA.id, at: 11, head: a.id))
        }
        let changed = RecordingTaskSelection(
            id: a.id, localScopeID: a.localScopeID, recordingID: a.recordingID, intervalID: a.intervalID,
            taskID: taskB.id, stamp: a.stamp, expectedHeadID: a.expectedHeadID)
        await #expect(throws: RecordingAttributionError.conflictingIdentity) {
            try await repository.selectTask(changed)
        }
        // Agent reports and notes are not pinned to the globally selected foreground task.
        let agent = fixture.event(.agentCompletion, at: 11)
        let note = fixture.event(.note, at: 12)
        _ = try await repository.commit(agent)
        _ = try await repository.commit(note)
        await #expect(throws: RecordingAttributionError.invalidBoundary) {
            try await repository.selectTask(selection(fixture, taskID: taskA.id, at: 5, head: b.id))
        }
        let finished = try await repository.commit(fixture.event(.finish, at: 20))
        // Exact selection retry is checked before active-interval authorization.
        #expect(try await repository.selectTask(a) == a)
        var state = try await repository.loadTaskAttribution(localScopeID: "local")
        #expect(state.taskID(for: agent) == nil)
        #expect(state.taskID(for: note) == nil)
        let segments = state.foregroundSegments(for: app, in: finished)
        #expect(segments.map(\.taskID) == [nil, taskA.id, taskB.id])
        #expect(segments.map(\.duration) == [1, 9, 10])
        let override = try await repository.correctTaskAttribution(correction(app, assignment: .task(taskB.id)))
        state = try await repository.loadTaskAttribution(localScopeID: "local")
        #expect(state.foregroundSegments(for: app, in: finished).map(\.duration) == [20])
        #expect(state.foregroundSegments(for: app, in: finished).first?.taskID == taskB.id)
        _ = try await repository.correctTaskAttribution(
            state.undoCommand(for: override, at: fixture.event(.note, at: 30).stamp.wall))
        state = try await repository.loadTaskAttribution(localScopeID: "local")
        #expect(state.foregroundSegments(for: app, in: finished) == segments)
        let head = try #require(state.head(eventID: app.id))
        _ = try await repository.correctTaskAttribution(correction(app, assignment: .unassigned, head: head.id))
        state = try await repository.loadTaskAttribution(localScopeID: "local")
        let unassigned = try #require(state.head(eventID: app.id))
        _ = try await repository.correctTaskAttribution(correction(app, assignment: .automatic, head: unassigned.id))
        state = try await repository.loadTaskAttribution(localScopeID: "local")
        #expect(state.foregroundSegments(for: app, in: finished) == segments)
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await reopened.loadTaskAttribution(localScopeID: "local") == state)
        await reopened.close()
    }

    @Test
    func scopeIsolationAndRecordingDeletionRetainSharedTaskAndRevokeGrants() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let shared = task(fixture, title: "Shared")
        let other = LocalTask(localScopeID: "other", title: "Private task", createdAt: shared.createdAt)
        _ = try await repository.createTask(shared)
        _ = try await repository.createTask(other)
        _ = try await repository.commit(fixture.event(.start))
        let grant = try await repository.issueCodexGrant(
            senderID: "synthetic-sender", threadID: "synthetic-thread", recordingID: fixture.recordingID,
            localScopeID: "local", intervalID: fixture.intervalID, issuedAt: fixture.event(.start, at: 1).stamp.wall,
            endpoint: "http://127.0.0.1:49871")
        let evidence = fixture.event(.note, at: 2)
        _ = try await repository.commit(evidence)
        _ = try await repository.selectTask(selection(fixture, taskID: shared.id, at: 3))
        _ = try await repository.commit(fixture.event(.finish, at: 4))
        await #expect(throws: RecordingAttributionError.invalidTarget) {
            try await repository.correctTaskAttribution(correction(evidence, assignment: .task(other.id)))
        }
        let wrongScope = RecordingAttributionCommand(
            localScopeID: "other", recordingID: evidence.recordingID, eventID: evidence.id,
            assignment: .task(other.id), createdAt: evidence.stamp.wall)
        await #expect(throws: RecordingAttributionError.invalidTarget) {
            try await repository.correctTaskAttribution(wrongScope)
        }
        let originalCommand = correction(evidence, assignment: .task(shared.id))
        _ = try await repository.correctTaskAttribution(originalCommand)
        let otherRecordingID = UUID()
        let otherIntervalID = UUID()
        let another = RecordingEvent(
            localScopeID: "local", recordingID: otherRecordingID,
            intervalID: otherIntervalID, kind: .note, stamp: fixture.event(.note, at: 21).stamp)
        _ = try await repository.commit(
            RecordingEvent(
                localScopeID: "local", recordingID: otherRecordingID,
                intervalID: otherIntervalID, kind: .start, stamp: fixture.event(.start, at: 20).stamp))
        _ = try await repository.commit(another)
        _ = try await repository.correctTaskAttribution(correction(another, assignment: .task(shared.id)))
        try await repository.delete(fixture.recordingID, localScopeID: "local")
        let state = try await repository.loadTaskAttribution(localScopeID: "local")
        #expect(state.tasks == [shared])
        #expect(state.selections.isEmpty)
        #expect(state.operations.count == 1)
        #expect(state.taskID(for: another) == shared.id)
        #expect(
            try await repository.codexGrants().first { $0.binding.bindingID == grant.binding.bindingID }?.revoked
                == true)
        await #expect(throws: RecordingAttributionError.invalidTarget) {
            try await repository.correctTaskAttribution(originalCommand)
        }
        #expect(try await repository.loadTaskAttribution(localScopeID: "other").tasks == [other])
        await repository.close()
    }

    @Test
    func versionOneMigrationPreservesOriginalPayloadsAndRollsBackSideTablesOnFailure() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        _ = try await repository.commit(fixture.event(.start))
        _ = try await repository.issueCodexGrant(
            senderID: "synthetic-sender", threadID: "synthetic-thread", recordingID: fixture.recordingID,
            localScopeID: "local", intervalID: fixture.intervalID, issuedAt: fixture.event(.start, at: 1).stamp.wall,
            endpoint: "http://127.0.0.1:49872")
        let grant = try #require(try await repository.codexGrants().first)
        let packet = try agentPacket(fixture, grant: grant)
        let noteBody = LocalHarnessContract.Note(
            version: 1, connectionID: UUID(), eventID: UUID(), text: "Keep original timestamp and bytes",
            reportedAt: CodexIntakeContract.timestamp(fixture.event(.note, at: 2).stamp.wall),
            epoch: UUID(), localScopeID: "local", recordingID: fixture.recordingID, intervalID: fixture.intervalID)
        let exactNote = try JSONEncoder().encode(noteBody)
        let note = RecordingEvent(
            id: noteBody.eventID, localScopeID: "local", recordingID: fixture.recordingID,
            intervalID: fixture.intervalID, kind: .note, stamp: fixture.event(.note, at: 3).stamp,
            text: noteBody.text,
            workNote: .init(exactBody: exactNote, bodyDigest: CodexIntakeContract.digest(exactNote)))
        _ = try await repository.commit(note)
        _ = try await repository.commit(fixture.event(.finish, at: 10))
        let acknowledgement = try await repository.receiveCodexPacket(
            packet, bindingID: grant.binding.bindingID, stamp: fixture.event(.note, at: 20).stamp)
        let pending = fixture.directory.appendingPathComponent("pending-v1-packet.json")
        let pendingBytes = try JSONEncoder().encode(packet)
        try pendingBytes.write(to: pending)
        await repository.close()
        let originalGrants = try fixture.sql("SELECT id, recording_id, hex(payload), revoked FROM codex_grants")
        // The pre-slice schema, with its migration ledger and original event bytes.
        _ = try fixture.sql("DROP TABLE codex_telemetry")
        _ = try fixture.sql("DELETE FROM grdb_migrations WHERE identifier = 'codex-telemetry-v3'")
        _ = try fixture.sql("DROP TABLE task_review_operations")
        _ = try fixture.sql("DROP TABLE local_tasks")
        _ = try fixture.sql("DELETE FROM grdb_migrations WHERE identifier = 'local-task-attribution-v2'")
        _ = try fixture.sql("PRAGMA user_version = 1")
        let original = try fixture.sql(
            "SELECT id, recording_id, sequence, payload FROM recording_events ORDER BY rowid")
        let failing = SQLiteRecordingRepository(
            url: fixture.url,
            checkpoint: { point in
                if point == .taskMigrationWritten { throw RecordingInjectedFailure.checkpoint }
            })
        await #expect(throws: RecordingInjectedFailure.self) { try await failing.load() }
        await failing.close()
        #expect(try fixture.sql("PRAGMA user_version") == [["1"]])
        #expect(try fixture.sql("SELECT name FROM sqlite_master WHERE name = 'local_tasks'").isEmpty)
        #expect(
            try fixture.sql("SELECT id, recording_id, sequence, payload FROM recording_events ORDER BY rowid")
                == original)
        let migrated = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await migrated.loadTaskAttribution(localScopeID: "local") == .init())
        _ = try await migrated.commit(note)
        _ = try await migrated.correctTaskAttribution(correction(note, assignment: .unassigned))
        #expect(
            try await migrated.receiveCodexPacket(
                packet, bindingID: grant.binding.bindingID, stamp: fixture.event(.note, at: 30).stamp)
                == acknowledgement)
        await migrated.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(
            try await reopened.receiveCodexPacket(
                packet, bindingID: grant.binding.bindingID, stamp: fixture.event(.note, at: 40).stamp)
                == acknowledgement)
        let events = try #require(try await reopened.load().first).events
        #expect(events.first { $0.id == note.id }?.workNote?.exactBody == exactNote)
        #expect(events.last?.agentMetadata?.exactBody == packet.body)
        #expect(events.last?.agentMetadata?.bodyDigest == CodexIntakeContract.digest(packet.body))
        await reopened.close()
        #expect(try fixture.sql("SELECT id, recording_id, hex(payload), revoked FROM codex_grants") == originalGrants)
        #expect(try Data(contentsOf: pending) == pendingBytes)
        #expect(try fixture.sql("PRAGMA user_version") == [["3"]])
        #expect(
            try fixture.sql("SELECT id, recording_id, sequence, payload FROM recording_events ORDER BY rowid")
                == original)
    }

    private func agentPacket(_ fixture: RecordingStoreFixture, grant: CodexIntakeContract.Grant) throws
        -> CodexIntakeContract.Packet
    {
        let binding = grant.binding
        var fields: [String: Any] = [
            "version": 1, "eventID": UUID().uuidString, "senderID": binding.senderID,
            "bindingID": binding.bindingID.uuidString, "localScopeID": binding.localScopeID,
            "recordingID": binding.recordingID.uuidString, "intervalID": binding.intervalID.uuidString,
            "threadID": binding.threadID, "turnID": "synthetic-turn", "invocationID": "synthetic-tool",
            "kind": "PostToolUse",
            "hookReceivedAt": CodexIntakeContract.timestamp(fixture.event(.note, at: 5).stamp.wall),
            "occurredAt": NSNull(), "timeBasis": "hookReceived", "toolName": "exec_command",
            "reportedResult": "success",
        ]
        let metadata = try JSONDecoder().decode(
            CodexIntakeContract.Metadata.self,
            from: JSONSerialization.data(withJSONObject: fields))
        fields["eventID"] = try #require(metadata.stableID).uuidString
        return CodexIntakeContract.sign(
            try JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]), key: grant.key)
    }

    private func task(_ fixture: RecordingStoreFixture, title: String) -> LocalTask {
        .init(localScopeID: "local", title: title, createdAt: fixture.event(.start).stamp.wall)
    }

    private func selection(
        _ fixture: RecordingStoreFixture, taskID: UUID?, at seconds: Double,
        head: UUID? = nil
    ) -> RecordingTaskSelection {
        .init(
            localScopeID: "local", recordingID: fixture.recordingID, intervalID: fixture.intervalID,
            taskID: taskID, stamp: fixture.event(.note, at: seconds).stamp, expectedHeadID: head)
    }

    private func correction(
        _ event: RecordingEvent, assignment: RecordingTaskAssignment,
        head: UUID? = nil
    ) -> RecordingAttributionCommand {
        .init(
            localScopeID: event.localScopeID, recordingID: event.recordingID, eventID: event.id,
            expectedHeadID: head, assignment: assignment, createdAt: event.stamp.wall.addingTimeInterval(100))
    }
}
