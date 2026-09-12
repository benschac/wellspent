import Foundation

@testable import TimerMac

actor RecordingModelRepositoryFixture: RecordingRepository {
    private var snapshots: [RecordingSnapshot]
    private(set) var attempts: [RecordingEvent] = []
    private(set) var closeCount = 0
    private var failuresRemaining = 0
    private var shouldHoldNext = false
    private var heldCommit: CheckedContinuation<Void, Never>?
    private var holdWaiter: CheckedContinuation<Void, Never>?

    init(snapshots: [RecordingSnapshot] = []) { self.snapshots = snapshots }

    func load() async throws -> [RecordingSnapshot] { snapshots }

    func failNext(_ count: Int = 1) { failuresRemaining = count }

    func holdNextCommit() { shouldHoldNext = true }

    func waitUntilCommitHeld() async {
        if heldCommit != nil { return }
        await withCheckedContinuation { holdWaiter = $0 }
    }

    func releaseCommit() {
        heldCommit?.resume()
        heldCommit = nil
    }

    func commit(_ event: RecordingEvent) async throws -> RecordingSnapshot {
        attempts.append(event)
        if shouldHoldNext {
            shouldHoldNext = false
            await withCheckedContinuation { continuation in
                heldCommit = continuation
                holdWaiter?.resume()
                holdWaiter = nil
            }
        }
        if failuresRemaining > 0 {
            failuresRemaining -= 1
            throw RecordingError.storage(13)
        }
        if let index = snapshots.firstIndex(where: { $0.id == event.recordingID }) {
            var snapshot = snapshots[index]
            try snapshot.append(event)
            snapshots[index] = snapshot
            return snapshot
        }
        let snapshot = try RecordingSnapshot.rebuild([event])
        snapshots.append(snapshot)
        return snapshot
    }

    func close() async { closeCount += 1 }
}

@MainActor
final class RecordingModelClockFixture {
    private let processID = UUID()
    private var seconds = 1_000.0

    func stamp() -> RecordingEvent.Stamp {
        defer { seconds += 1 }
        return .init(wall: Date(timeIntervalSince1970: 1_800_000_000 + seconds), uptime: seconds, processID: processID)
    }
}
