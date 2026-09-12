import Foundation
import SQLite3

/// Confined to RecordingDatabaseExecutor. Statements never escape an operation.
final class RecordingSQLiteConnection {
    private let handle: OpaquePointer

    init(url: URL) throws {
        var opened: OpaquePointer?
        let result = sqlite3_open_v2(
            url.path, &opened, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
        guard result == SQLITE_OK, let opened else {
            if let opened { sqlite3_close_v2(opened) }
            throw RecordingError.storage(result)
        }
        handle = opened
        sqlite3_extended_result_codes(handle, 1)
        sqlite3_busy_timeout(handle, 250)
    }

    deinit { sqlite3_close_v2(handle) }

    func rows(_ sql: String, _ bindings: [String] = []) throws -> [[String]] {
        var prepared: OpaquePointer?
        let result = sqlite3_prepare_v2(handle, sql, -1, &prepared, nil)
        guard result == SQLITE_OK, let statement = prepared else { throw RecordingError.storage(result) }
        defer { sqlite3_finalize(statement) }
        for (index, value) in bindings.enumerated() {
            let bound = value.withCString { bytes in
                sqlite3_bind_text(
                    statement, Int32(index + 1), bytes, Int32(value.utf8.count),
                    unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            }
            guard bound == SQLITE_OK else { throw RecordingError.storage(bound) }
        }
        var rows: [[String]] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return rows }
            guard step == SQLITE_ROW else { throw RecordingError.storage(step) }
            var row: [String] = []
            for column in 0..<sqlite3_column_count(statement) {
                guard let bytes = sqlite3_column_text(statement, column) else { throw RecordingError.invalidStore }
                let count = Int(sqlite3_column_bytes(statement, column))
                row.append(String(decoding: UnsafeBufferPointer(start: bytes, count: count), as: UTF8.self))
            }
            rows.append(row)
        }
    }

    func execute(_ sql: String, _ bindings: [String] = []) throws { _ = try rows(sql, bindings) }

    func scalar(_ sql: String, _ bindings: [String] = []) throws -> String {
        guard let value = try rows(sql, bindings).first?.first else { throw RecordingError.invalidStore }
        return value
    }

}
