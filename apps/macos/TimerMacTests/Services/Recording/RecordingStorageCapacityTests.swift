import Foundation
import SQLite3
import Testing

@testable import TimerMac

struct RecordingStorageCapacityTests {
    @Test
    func observationRacingPauseCannotBeCommittedAfterTheBoundary() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        _ = try await repository.commit(fixture.event(.start))
        let sample = fixture.event(.application, at: 1)
        let pause = fixture.event(.pause, at: 2)
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask {
                do { _ = try await repository.commit(sample) } catch RecordingError.staleInterval {
                    // Pause won the serialized race.
                }
            }
            group.addTask { _ = try await repository.commit(pause) }
            try await group.waitForAll()
        }
        let saved = try #require(try await repository.load().first)
        #expect(saved.status == .paused)
        #expect(saved.events.last == pause)
        #expect(saved.events.count == 2 || saved.events.count == 3)
        await repository.close()
    }

    @Test
    func actualSQLiteFullRollsBackAndPreservesEarlierHistory() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let seed = SQLiteRecordingRepository(url: fixture.url)
        let original = try await seed.commit(fixture.event(.start))
        await seed.close()
        let limited = SQLiteRecordingRepository(
            url: fixture.url,
            openConnection: { url in
                let db = try RecordingSQLiteConnection(url: url)
                let pageCount = try db.scalar("PRAGMA page_count")
                guard let limit = Int(pageCount) else { throw RecordingError.invalidStore }
                try db.execute("PRAGMA max_page_count = \(limit)")
                return db
            })
        await #expect(throws: RecordingError.storage(SQLITE_FULL)) {
            try await limited.commit(fixture.event(.note, at: 1, text: String(repeating: "x", count: 16_384)))
        }
        #expect(try await limited.load() == [original])
        await limited.close()
        let reopened = SQLiteRecordingRepository(url: fixture.url)
        #expect(try await reopened.load() == [original])
        await reopened.close()
    }

    @Test
    func sqliteBusyHasBoundedFailureAndCanRetrySameEvent() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let original = try await repository.commit(fixture.event(.start))
        let blocker = try RecordingSQLiteConnection(url: fixture.url)
        try blocker.execute("BEGIN IMMEDIATE")
        let pending = fixture.event(.pause, at: 1)
        await #expect(throws: RecordingError.storage(SQLITE_BUSY)) { try await repository.commit(pending) }
        try blocker.execute("ROLLBACK")
        #expect(try await repository.load() == [original])
        #expect(try await repository.commit(pending).events == original.events + [pending])
        await repository.close()
    }
}
