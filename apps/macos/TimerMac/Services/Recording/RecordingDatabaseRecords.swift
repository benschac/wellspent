import Foundation
import SQLiteData

// Keep storage representations separate from the event/domain model. Existing UUIDs remain text.
@Table("recordings")
struct RecordingRecord: Sendable {
    let id: String
    let scope: String
}

@Table("recording_events")
struct RecordingEventRecord: Sendable {
    let id: String
    @Column("recording_id") let recordingID: String
    let sequence: Int
    let payload: String
}

@Table("local_tasks")
struct LocalTaskRecord: Sendable {
    let id: String
    let scope: String
    @Column("creation_command_id") let creationCommandID: String
    let payload: String
}

@Table("task_review_operations")
struct TaskReviewRecord: Sendable {
    let sequence: Int64
    @Column("command_id") let commandID: String
    let scope: String
    @Column("recording_id") let recordingID: String
    let kind: String
    @Column("schema_version") let schemaVersion: Int
    let payload: String
}

@Table("codex_grants")
struct CodexGrantRecord: Sendable {
    let id: String
    @Column("recording_id") let recordingID: String
    let payload: Data
    let revoked: Int
}

@Table("codex_telemetry")
struct CodexTelemetryRecord: Sendable {
    let id: String
    @Column("binding_id") let bindingID: String
    @Column("recording_id") let recordingID: String
    let scope: String
    let kind: String
    let body: Data
    let receipt: Data
}

// Read-only projection of SQLite's schema catalog; never created by our migrations.
@Table("sqlite_master")
struct RecordingSchemaEntry: Sendable {
    let type: String
    let name: String
}
