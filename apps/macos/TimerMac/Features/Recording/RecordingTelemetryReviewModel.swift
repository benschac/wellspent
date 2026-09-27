import Foundation
import Observation

@MainActor
@Observable
final class RecordingTelemetryReviewModel {
    struct Selection: Hashable {
        let recordingID: UUID
        let intervalID: UUID
        let revision: Int
        var refresh: Int = 0

        func hasSameInterval(as other: Self) -> Bool {
            recordingID == other.recordingID && intervalID == other.intervalID
        }
    }

    enum State: Equatable {
        case loading
        case loaded([RecordingTelemetryObservation])
        case failed
    }

    private(set) var selection: Selection?
    private(set) var state: State = .loading
    private var requestID = UUID()

    func load(
        _ selection: Selection,
        fetch: () async throws -> [RecordingTelemetryObservation]
    ) async {
        let requestID = UUID()
        self.requestID = requestID
        // A revision/refresh reloads the same data scope. Keep committed rows visible
        // until replacement data arrives, but never carry them across interval changes.
        let preservesRows = self.selection?.hasSameInterval(as: selection) == true
        self.selection = selection
        if !preservesRows || state == .failed { state = .loading }
        do {
            let observations = try await fetch()
            guard self.requestID == requestID, !Task.isCancelled else { return }
            state = .loaded(observations)
        } catch {
            guard self.requestID == requestID, !Task.isCancelled else { return }
            state = .failed
        }
    }
}
