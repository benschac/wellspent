import Foundation
import SQLite3
import SQLiteData
import Testing
import os

@testable import TimerMac

struct SQLiteRecordingRepositoryTests {
    @Test
    func historyKeepsNewestInsertionFirstAcrossReopen() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        // Insert in reverse UUID order so sorting by identity would give the wrong result.
        let firstID = try #require(UUID(uuidString: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"))
        let secondID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000001"))
        let repository = SQLiteRecordingRepository(url: fixture.url)
        var completed: [RecordingSnapshot] = []
        for id in [firstID, secondID] {
            for (kind, seconds) in [(RecordingEvent.Kind.start, 0.0), (.finish, 1.0)] {
                let event = RecordingEvent(
                    localScopeID: "local", recordingID: id, intervalID: fixture.intervalID,
                    kind: kind, stamp: fixture.event(kind, at: seconds).stamp)
                let saved = try await repository.commit(event)
                if kind == .finish { completed.insert(saved, at: 0) }
            }
        }
        #expect(try await repository.load() == completed)
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await reopened.load() == completed)
        await reopened.close()
    }

    @Test
    func simultaneousFirstCommitsShareOneOpenAndDeduplicateTheEvent() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let openCount = OSAllocatedUnfairLock(initialState: 0)
        let repository = SQLiteRecordingRepository(
            url: fixture.url,
            prepareDatabase: { _ in openCount.withLock { $0 += 1 } })
        let start = fixture.event(.start)

        async let first = repository.commit(start)
        async let retry = repository.commit(start)
        let (saved, retried) = try await (first, retry)

        #expect(saved == retried)
        #expect(saved.events == [start])
        #expect(openCount.withLock { $0 } == 1)
        #expect(try await repository.load() == [saved])
        await repository.close()
        #expect(try fixture.sql("SELECT COUNT(*) FROM recording_events") == [["1"]])
    }

    @Test(arguments: [false, true])
    func closeRejectsFurtherOperationsWithoutOpeningOrChangingTheStore(openFirst: Bool) async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let start = fixture.event(.start)
        if openFirst { _ = try await repository.commit(start) }
        await repository.close()
        await repository.close()

        await #expect(throws: RecordingError.closed) { try await repository.load() }
        await #expect(throws: RecordingError.closed) { try await repository.commit(start) }
        await #expect(throws: RecordingError.closed) {
            try await repository.delete(start.recordingID, localScopeID: start.localScopeID)
        }
        if openFirst {
            let reopened = SQLiteRecordingRepository(url: fixture.url)
            #expect(try await reopened.load().first?.events == [start])
            await reopened.close()
        } else {
            #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).isEmpty)
        }
    }

    @Test
    func legacyVersionOneStoreRetainsEventsAndRetryIdentity() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let start = fixture.event(.start, text: "Recorded before SQLiteData")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let payload = String(decoding: try encoder.encode(start), as: UTF8.self)
        let legacy = try DatabaseQueue(path: fixture.url.path)
        try await legacy.write { db in
            // Exact schema and version markers from the original SQLite3 implementation.
            try db.execute(
                sql: """
                    CREATE TABLE recordings (id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL) STRICT;
                    CREATE TABLE recording_events (
                        id TEXT PRIMARY KEY NOT NULL,
                        recording_id TEXT NOT NULL REFERENCES recordings(id),
                        sequence INTEGER NOT NULL CHECK(sequence > 0),
                        payload TEXT NOT NULL,
                        UNIQUE(recording_id, sequence)
                    ) STRICT;
                    PRAGMA application_id = 1465078354;
                    PRAGMA user_version = 1;
                    """)
            try db.execute(
                sql: "INSERT INTO recordings (id, scope) VALUES (?, ?)",
                arguments: [start.recordingID.uuidString, start.localScopeID])
            try db.execute(
                sql: "INSERT INTO recording_events (id, recording_id, sequence, payload) VALUES (?, ?, 1, ?)",
                arguments: [start.id.uuidString, start.recordingID.uuidString, payload])
        }
        try legacy.close()

        let repository = SQLiteRecordingRepository(url: fixture.url)
        let saved = try #require(try await repository.load().first)
        #expect(saved.events == [start])
        #expect(try await repository.commit(start) == saved)
        let pause = fixture.event(.pause, at: 5)
        #expect(try await repository.commit(pause).events == [start, pause])
        await repository.close()

        #expect(try fixture.sql("SELECT payload FROM recording_events WHERE sequence = 1") == [[payload]])
        #expect(try fixture.sql("SELECT sequence FROM recording_events ORDER BY sequence") == [["1"], ["2"]])
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await reopened.commit(start).events == [start, pause])
        await reopened.close()
    }

    @Test
    func lifecycleSurvivesCloseAndReopenExactly() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let secondInterval = UUID()
        let events = [
            fixture.event(.start, text: "Offline work"),
            fixture.event(.application, at: 2, text: "Synthetic editor"),
            fixture.event(.note, at: 3, text: "First note"),
            fixture.event(.pause, at: 10),
            fixture.event(.resume, at: 20, interval: secondInterval),
            fixture.event(.finish, at: 35, interval: secondInterval),
        ]
        for event in events { _ = try await repository.commit(event) }
        let committed = try #require(try await repository.load().first)
        #expect(committed.status == .finished)
        #expect(committed.events == events)
        #expect(committed.intervals.map(\.committedDuration) == [10, 15])
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        let recovered = try await reopened.load()
        #expect(recovered == [committed])
        await reopened.close()
    }

    @Test
    func exactRetriesDoNotAppendAndConflictingIdentityPreservesOriginal() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let start = fixture.event(.start, text: "Original")
        _ = try await repository.commit(start)
        let note = fixture.event(.note, at: 1, text: "Saved")
        let saved = try await repository.commit(note)
        #expect(try await repository.commit(start) == saved)
        #expect(try await repository.commit(note) == saved)
        await #expect(throws: RecordingError.conflictingIdentity) {
            try await repository.commit(fixture.event(.note, at: 1, id: note.id, text: "Different"))
        }
        #expect(try await repository.load() == [saved])
        await repository.close()
        #expect(try fixture.sql("SELECT sequence FROM recording_events ORDER BY sequence") == [["1"], ["2"]])
    }

    @Test
    func lostAcknowledgementCanRetryAfterReopenWithoutDuplicate() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(
            url: fixture.url,
            checkpoint: { checkpoint in
                if checkpoint == .committed { throw RecordingInjectedFailure.checkpoint }
            })
        let start = fixture.event(.start)
        await #expect(throws: RecordingInjectedFailure.self) { try await repository.commit(start) }
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        let retried = try await reopened.commit(start)
        #expect(retried.events == [start])
        #expect(try await reopened.load() == [retried])
        await reopened.close()
        #expect(try fixture.sql("SELECT COUNT(*) FROM recording_events") == [["1"]])
    }

    @Test
    func interruptedMigrationRollsBackSchemaAndVersionTogether() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(
            url: fixture.url,
            checkpoint: { checkpoint in
                if checkpoint == .migrationWritten { throw RecordingInjectedFailure.checkpoint }
            })
        await #expect(throws: RecordingInjectedFailure.self) { try await repository.load() }
        await repository.close()
        #expect(try fixture.sql("PRAGMA user_version") == [["0"]])
        #expect(try fixture.sql("PRAGMA application_id") == [["0"]])
        #expect(
            try fixture.sql("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'grdb_migrations'").isEmpty
        )
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await reopened.load().isEmpty)
        _ = try await reopened.commit(fixture.event(.start))
        await reopened.close()
        #expect(try fixture.sql("PRAGMA user_version") == [["1"]])
    }

    @Test
    func failedFirstEventRollsBackRecordingAndEventTogether() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(
            url: fixture.url,
            checkpoint: { checkpoint in
                if checkpoint == .eventWritten { throw RecordingInjectedFailure.checkpoint }
            })
        let start = fixture.event(.start)
        await #expect(throws: RecordingInjectedFailure.self) { try await repository.commit(start) }
        #expect(try await repository.load().isEmpty)
        await repository.close()
        #expect(try fixture.sql("SELECT COUNT(*) FROM recordings") == [["0"]])
        #expect(try fixture.sql("SELECT COUNT(*) FROM recording_events") == [["0"]])
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await reopened.commit(start).events == [start])
        await reopened.close()
    }

    @Test
    func failedBoundaryPreservesPreviouslyCommittedCoverage() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let initial = SQLiteRecordingRepository(url: fixture.url)
        let start = fixture.event(.start)
        _ = try await initial.commit(start)
        await initial.close()
        let failing = SQLiteRecordingRepository(
            url: fixture.url,
            checkpoint: { checkpoint in
                if checkpoint == .eventWritten { throw RecordingInjectedFailure.checkpoint }
            })
        await #expect(throws: RecordingInjectedFailure.self) {
            try await failing.commit(fixture.event(.pause, at: 5))
        }
        await failing.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        let saved = try #require(try await reopened.load().first)
        #expect(saved.events == [start])
        #expect(saved.status == .recording)
        #expect(saved.intervals.first?.end == nil)
        await reopened.close()
    }

    @Test
    func commitOrderSurvivesOutOfOrderTimestampsAndLateReportRetry() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let events = [
            fixture.event(.start), fixture.event(.application, at: 8),
            fixture.event(.application, at: 3), fixture.event(.pause, at: 10),
            fixture.event(
                .agentCompletion, at: 20, text: "Late synthetic report",
                occurredAt: Date(timeIntervalSince1970: 1_800_000_005)),
        ]
        for event in events { _ = try await repository.commit(event) }
        for event in events { _ = try await repository.commit(event) }
        await repository.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await reopened.load().first?.events == events)
        await reopened.close()
        #expect(
            try fixture.sql("SELECT sequence FROM recording_events ORDER BY sequence") == [
                ["1"], ["2"], ["3"], ["4"], ["5"],
            ])
    }

    @Test
    func accountScopeCannotAppendToAnotherRecording() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let original = try await repository.commit(fixture.event(.start, scope: "account-a"))
        await #expect(throws: RecordingError.staleInterval) {
            try await repository.commit(fixture.event(.note, at: 1, scope: "account-b"))
        }
        #expect(try await repository.load() == [original])
        await repository.close()
    }

    @Test
    func explicitDeletionRemovesOnlyTheRequestedLocalRecording() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let saved = try await repository.commit(fixture.event(.start, scope: "local"))
        _ = try await repository.commit(fixture.event(.finish, at: 2))
        try await repository.delete(saved.id, localScopeID: "local")
        #expect(try await repository.load().isEmpty)
        #expect(try fixture.sql("SELECT COUNT(*) FROM recording_events") == [["0"]])
        await repository.close()
    }
}
