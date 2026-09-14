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
        if mode.hasPrefix("codex-") {
            try await codex(mode: mode, url: url, phase: phase)
            return
        }
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

    static func codex(mode: String, url: URL, phase: String) async throws {
        let repository = SQLiteRecordingRepository(
            url: url,
            checkpoint: { point in
                if mode == "codex-crash",
                    (phase == "before" && point == .beforeWrite)
                        || (phase == "during" && point == .eventWritten)
                        || (phase == "after" && point == .committed)
                {
                    kill(getpid(), SIGKILL)
                }
            })
        if mode == "codex-seed" {
            let recordingID = UUID()
            let intervalID = UUID()
            let now = Date()
            _ = try await repository.commit(
                codexEvent(.start, recordingID: recordingID, intervalID: intervalID, at: now.addingTimeInterval(-10)))
            let bundle = try await repository.issueCodexGrant(
                senderID: "synthetic-sender", threadID: "synthetic-thread", recordingID: recordingID,
                localScopeID: "synthetic-codex", intervalID: intervalID, issuedAt: now.addingTimeInterval(-5),
                endpoint: phase)
            // The runner sends this public synthetic capability to setup through stdin, never logs it.
            print(String(decoding: try JSONEncoder().encode(bundle), as: UTF8.self))
        } else if mode == "codex-close" {
            guard let snapshot = try await repository.load().first, let intervalID = snapshot.activeIntervalID else {
                throw RecordingError.invalidStore
            }
            _ = try await repository.commit(
                codexEvent(.finish, recordingID: snapshot.id, intervalID: intervalID, at: Date()))
        } else {
            guard let grant = try await repository.codexGrants().first else { throw RecordingError.invalidStore }
            let transport = try LocalCodexTransport(endpoint: grant.endpoint)
            let priorEvents = try await repository.load().flatMap(\.events).filter { $0.agentMetadata != nil }
            let response = try await transport.poll(bindingID: grant.binding.bindingID, key: grant.key)
            if mode == "codex-verify-acked" {
                guard response.packet == nil, response.status.pending == 0, priorEvents.count == 1 else {
                    throw RecordingError.invalidStore
                }
            } else {
                guard let packet = response.packet else { throw RecordingError.invalidStore }
                let stamp = RecordingEvent.Stamp(wall: Date(), uptime: 1000, processID: UUID())
                let ack = try await repository.receiveCodexPacket(
                    packet, bindingID: grant.binding.bindingID, stamp: stamp)
                if mode == "codex-crash", phase == "beforeACK" { kill(getpid(), SIGKILL) }
                let receipt = try JSONDecoder().decode(CodexIntakeContract.Receipt.self, from: ack.body)
                let snapshots = try await repository.load()
                let events = snapshots.flatMap(\.events)
                guard events.count == 3, let agentEvent = events.first(where: { $0.agentMetadata != nil }),
                    agentEvent.agentMetadata?.exactBody == packet.body,
                    receipt.nativeReceivedAt == CodexIntakeContract.timestamp(agentEvent.stamp.wall),
                    priorEvents.first.map({ $0 == agentEvent }) ?? true
                else { throw RecordingError.invalidStore }
                try await transport.acknowledge(ack)
                if mode == "codex-crash", phase == "afterACK" { kill(getpid(), SIGKILL) }
                // An exact ACK replay also succeeds after the helper has deleted pending metadata.
                try await transport.acknowledge(ack)
                guard try await transport.poll(bindingID: grant.binding.bindingID, key: grant.key).packet == nil else {
                    throw RecordingError.invalidStore
                }
            }
            if mode == "codex-crash" { throw RecordingError.invalidStore }
            print("PASS \(mode) \(phase)")
        }
        await repository.close()
    }

    static func codexEvent(_ kind: RecordingEvent.Kind, recordingID: UUID, intervalID: UUID, at date: Date)
        -> RecordingEvent
    {
        RecordingEvent(
            localScopeID: "synthetic-codex", recordingID: recordingID, intervalID: intervalID, kind: kind,
            stamp: .init(
                wall: date, uptime: date.timeIntervalSince1970,
                processID: UUID(uuid: (0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2))))
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
