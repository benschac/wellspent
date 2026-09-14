# macOS recording persistence: SQLiteData

September 13, 2026. SQLiteData is the native recording persistence adapter, with
GRDB managing SQLite access. SwiftUI/AppKit, native Observation and Swift
concurrency remain the application stack. CloudKit, encrypted replication and
additional reactive state libraries are not part of this change.

## Ownership

- `RecordingModel` remains `@MainActor @Observable`. Its committed snapshots,
  pending actions and capture authorization retain their existing behavior.
- `RecordingRepository` remains the application boundary. The actor coordinates
  lazy opening and closure; GRDB serializes database access and transactions.
- `RecordingDatabaseRecords.swift` defines SQLiteData `@Table` storage records,
  distinct from domain events. SQLiteData typed queries perform record lookup,
  insert, delete, schema-catalog inspection and ordered event reads. GRDB’s
  schema builder defines tables and constraints; native foreign-key introspection
  validates references. SQLite PRAGMAs remain explicit SQL.
- `SQLiteRecordingRepository` keeps event identity checks, validation and insertion
  in one transaction. Appends rebuild only their recording's event history;
  opening, full history loads and starting a recording still validate all history.
- The custom SQLite C wrapper and custom serial executor are removed.

The UI continues to update from successful repository commits. This change does
not introduce a second observation-driven writer or alter collection permission
boundaries. SQLiteData reactive fetching is available for future query screens.

## Compatibility and durability

SQLiteData is pinned to **1.11.0**, compatible with the installed Swift 6.3.3
compiler. Release 1.12.0 requires Swift tools 6.4. The Xcode `Package.resolved`
locks transitive versions; the crash harness uses the same pins.
StructuredQueries is explicitly pinned to **0.36.0**, the baseline declared by
SQLiteData 1.11.0: resolving its broad range to 0.39.2 produced upstream
`TableColumns` compilation errors. Revisit these pins together after upgrading
the compiler and SQLiteData. The Xcode app and test targets explicitly link
GRDB and StructuredQueriesSQLite because they use their reexported public types;
this avoids undefined-symbol errors with Xcode’s generated package frameworks.

Existing version-1 databases are adopted by GRDB's `recording-v1` migration
without rewriting event payloads or identities. New stores retain the same
application ID, strict tables, sequence constraints and foreign keys. GRDB adds
its migration ledger. Migration failure must roll back domain schema and version
together; a migration-ledger table may remain.

The connection retains DELETE journaling, synchronous EXTRA, fullfsync and a
250 ms busy timeout. Unknown schemas, unrelated databases and invalid content
are rejected. No user database is reset. SQLite storage remains unencrypted, as
previously chosen for local capture; this is distinct from the future vault.

## Verification

Run the macOS Xcode tests and `bun run --cwd apps/macos test:recording:crash`.
Tests cover legacy-store adoption, lifecycle/reopen, duplicate/conflicting event
IDs, lost acknowledgement, migration rollback, write rollback, SQLITE_FULL,
SQLITE_BUSY and recording model behavior. The crash runner builds production
sources with SwiftPM and kills only its disposable helper at four checkpoints.

SQLiteData's dependency graph includes Swift macros. Enable those packages in
Xcode when prompted. For unattended verification of the resolved packages,
`xcodebuild ... -skipMacroValidation ... test` enables macros for that invocation;
it does not change global Xcode trust settings.

Unsigned builds and synthetic tests do not establish signed-distribution,
physical-device, live capture, or power-loss acceptance.

Verified on September 13, 2026: unsigned Xcode full suite passed (175 tests,
208 device test executions). After the schema-builder refinement, the focused
recording suite passed (30 tests, 32 executions). The final production-source
crash harness passed all four SIGKILL checkpoints. Targeted Swift formatting,
JavaScript syntax, project-file parsing and diff whitespace checks passed.
