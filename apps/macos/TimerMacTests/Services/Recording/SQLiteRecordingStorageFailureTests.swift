import Foundation
import SQLite3
import Testing

@testable import TimerMac

struct SQLiteRecordingStorageFailureTests {
    @Test
    func unknownSchemaIsRejectedWithoutChangingExistingBytes() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        _ = try fixture.sql("CREATE TABLE future_data (content TEXT)")
        _ = try fixture.sql("INSERT INTO future_data VALUES ('preserve me')")
        _ = try fixture.sql("PRAGMA user_version = 99")
        let before = try Data(contentsOf: fixture.url)
        let repository = SQLiteRecordingRepository(url: fixture.url)
        await #expect(throws: RecordingError.unsupportedSchema) { try await repository.load() }
        await repository.close()
        #expect(try Data(contentsOf: fixture.url) == before)
        #expect(try fixture.sql("SELECT content FROM future_data") == [["preserve me"]])
    }

    @Test
    func unrelatedDatabaseIsNotMigratedOrReset() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        _ = try fixture.sql("CREATE TABLE unrelated (content TEXT)")
        _ = try fixture.sql("INSERT INTO unrelated VALUES ('preserve me')")
        let before = try Data(contentsOf: fixture.url)
        let repository = SQLiteRecordingRepository(url: fixture.url)
        await #expect(throws: RecordingError.invalidStore) { try await repository.load() }
        await repository.close()
        #expect(try Data(contentsOf: fixture.url) == before)
        #expect(try fixture.sql("PRAGMA user_version") == [["0"]])
    }

    @Test
    func corruptFileIsRejectedAndPreserved() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let corrupt = Data("This is deliberately not a SQLite database. Preserve these bytes.".utf8)
        try corrupt.write(to: fixture.url)
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let failure = await #expect(throws: RecordingError.self) { try await repository.load() }
        #expect(failure == .storage(SQLITE_NOTADB))
        await repository.close()
        #expect(try Data(contentsOf: fixture.url) == corrupt)
    }

    @Test
    func unwritableDatabasePreservesCommittedHistory() async throws {
        let fixture = try RecordingStoreFixture()
        defer {
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fixture.url.path)
            fixture.remove()
        }
        let initial = SQLiteRecordingRepository(url: fixture.url)
        _ = try await initial.commit(fixture.event(.start))
        await initial.close()
        let before = try Data(contentsOf: fixture.url)
        try FileManager.default.setAttributes([.posixPermissions: 0o400], ofItemAtPath: fixture.url.path)
        let repository = SQLiteRecordingRepository(url: fixture.url)
        let failure = await #expect(throws: RecordingError.self) {
            try await repository.commit(fixture.event(.pause, at: 5))
        }
        #expect(failure == .storage(SQLITE_CANTOPEN) || failure == .storage(SQLITE_READONLY))
        await repository.close()
        #expect(try Data(contentsOf: fixture.url) == before)
    }

    @Test
    func missingParentFailsWithoutCreatingAnAlternateStore() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let missingURL = fixture.directory.appendingPathComponent("missing/recordings.sqlite")
        let repository = SQLiteRecordingRepository(url: missingURL)
        await #expect(throws: RecordingError.storage(SQLITE_CANTOPEN)) { try await repository.load() }
        await repository.close()
        #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).isEmpty)
    }

    @Test
    func disappearingOpenedStoreFailsWithoutRecreatingIt() async throws {
        let fixture = try RecordingStoreFixture()
        defer { fixture.remove() }
        let repository = SQLiteRecordingRepository(url: fixture.url)
        _ = try await repository.commit(fixture.event(.start))
        let preserved = fixture.directory.appendingPathComponent("preserved.sqlite")
        try FileManager.default.moveItem(at: fixture.url, to: preserved)
        let before = try Data(contentsOf: preserved)
        await #expect(throws: RecordingError.invalidStore) {
            try await repository.commit(fixture.event(.pause, at: 5))
        }
        await repository.close()
        #expect(FileManager.default.fileExists(atPath: fixture.url.path) == false)
        #expect(try Data(contentsOf: preserved) == before)
        let reopened = SQLiteRecordingRepository(url: preserved)
        #expect(try await reopened.load().first?.events.count == 1)
        await reopened.close()
    }
}
