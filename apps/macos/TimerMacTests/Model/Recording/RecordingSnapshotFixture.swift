import Foundation

@testable import TimerMac

struct RecordingSnapshotFixture {
    let recordingID = UUID()
    let intervalID = UUID()
    let processID = UUID()

    func wall(_ seconds: Double) -> Date {
        Date(timeIntervalSince1970: 1_800_000_000 + seconds)
    }

    func started() throws -> RecordingSnapshot {
        try RecordingSnapshot.rebuild([event(.start, seconds: 0, text: "Investigate local durability")])
    }

    func event(
        _ kind: RecordingEvent.Kind,
        id: UUID = UUID(),
        seconds: Double,
        wallSeconds: Double? = nil,
        intervalID: UUID? = nil,
        processID: UUID? = nil,
        occurredAt: Date? = nil,
        text: String = "",
        scope: String = "local-workspace",
        recordingID: UUID? = nil
    ) -> RecordingEvent {
        RecordingEvent(
            id: id, localScopeID: scope, recordingID: recordingID ?? self.recordingID,
            intervalID: intervalID ?? self.intervalID, kind: kind,
            stamp: .init(
                wall: wall(wallSeconds ?? seconds), uptime: 100 + seconds, processID: processID ?? self.processID),
            occurredAt: occurredAt, timeBasis: occurredAt == nil ? .receiver : .sourceReported, text: text)
    }
}
