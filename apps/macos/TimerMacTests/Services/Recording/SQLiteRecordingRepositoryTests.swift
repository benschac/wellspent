import Foundation
import SQLite3
import Testing

@testable import TimerMac

struct SQLiteRecordingRepositoryTests {
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
        #expect(try fixture.sql("SELECT name FROM sqlite_master WHERE type = 'table'").isEmpty)
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
}
