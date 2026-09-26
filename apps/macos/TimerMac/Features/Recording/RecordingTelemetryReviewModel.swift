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
        self.selection = selection
        state = .loading
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
