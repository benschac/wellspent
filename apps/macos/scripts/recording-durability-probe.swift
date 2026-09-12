import Darwin
import Foundation

/// Disposable process only. Compiled with the actual repository/domain sources by the runner.
@main
struct RecordingDurabilityProbe {
    static func main() async throws {
        let arguments = CommandLine.arguments
        guard arguments.count == 4 else { throw RecordingError.invalidEvent }
        let mode = arguments[1]
        let url = URL(fileURLWithPath: arguments[2])
        let phase = arguments[3]
        let repository = SQLiteRecordingRepository(
            url: url,
            checkpoint: { point in
                let mustCrash =
                    (phase == "before" && point == .beforeWrite)
                    || (phase == "during" && point == .eventWritten)
                    || (phase == "after" && point == .committed)
                    || (phase == "migration" && point == .migrationWritten)
                if mode == "crash", mustCrash { kill(getpid(), SIGKILL) }
            })
        if phase == "migration" {
            let records = try await repository.load()
            guard records.isEmpty else { throw RecordingError.invalidStore }
        } else if mode == "seed" {
            let start = event(.start, recordingID: UUID(), intervalID: UUID(), uptime: 1)
            _ = try await repository.commit(start)
            _ = try await repository.commit(
                event(.finish, recordingID: start.recordingID, intervalID: start.intervalID, uptime: 2))
        } else if mode == "crash" {
            _ = try await repository.commit(event(.start, recordingID: UUID(), intervalID: UUID(), uptime: 3))
            throw RecordingError.invalidStore  // Every crash checkpoint must actually execute.
        } else if mode == "verify" {
            let records = try await repository.load()
            guard records.count == (phase == "after" ? 2 : 1),
                records.filter({ $0.status == .finished }).count == 1,
                records.flatMap(\.events).count == (phase == "after" ? 3 : 2)
            else { throw RecordingError.invalidStore }
            if let unfinished = records.first(where: { $0.status == .recording }) {
                let recovered = try await repository.commit(
                    event(
                        .interrupt, recordingID: unfinished.id, intervalID: unfinished.activeIntervalID, uptime: 4))
                guard recovered.status == .interrupted, recovered.intervals.last?.committedDuration == nil else {
                    throw RecordingError.invalidStore
                }
            }
        } else {
            throw RecordingError.invalidEvent
        }
        await repository.close()
        print("PASS \(mode) \(phase)")
    }

    static func event(_ kind: RecordingEvent.Kind, recordingID: UUID, intervalID: UUID?, uptime: Double)
        -> RecordingEvent
    {
        // Stable process marker for the seed pair; a crash interruption never derives elapsed time from it.
        let processID = UUID(uuid: (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1))
        return RecordingEvent(
            localScopeID: "crash-probe", recordingID: recordingID, intervalID: intervalID, kind: kind,
            stamp: .init(
                wall: Date(timeIntervalSince1970: 1_800_000_000 + uptime), uptime: uptime, processID: processID),
            text: "Synthetic crash fixture")
    }
}
