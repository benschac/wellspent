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

// Read-only projection of SQLite's schema catalog; never created by our migrations.
@Table("sqlite_master")
struct RecordingSchemaEntry: Sendable {
    let type: String
    let name: String
}
