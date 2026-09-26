import SwiftUI

struct RecordingTelemetryReviewView: View {
    private struct TurnIdentity: Hashable {
        let threadID: String
        let sessionID: String
        let turnID: String
        let rootTurnID: String

        init(_ metadata: CodexTelemetryContract.Metadata) {
            threadID = metadata.threadID
            sessionID = metadata.sessionID
            turnID = metadata.turnID
            rootTurnID = metadata.rootTurnID
        }
    }

    @Environment(RecordingModel.self) private var recordingModel
    let recording: RecordingSnapshot
    @State private var intervalID: UUID?
    @State private var review = RecordingTelemetryReviewModel()
    @State private var refresh = 0

    init(recording: RecordingSnapshot) {
        self.recording = recording
        _intervalID = State(initialValue: recording.intervals.last(where: { $0.end != nil })?.id)
    }

    private var closedIntervals: [RecordingSnapshot.Interval] {
        recording.intervals.filter { $0.end != nil }
    }

    private var selection: RecordingTelemetryReviewModel.Selection? {
        guard let interval = closedIntervals.first(where: { $0.id == intervalID }) ?? closedIntervals.last else {
            return nil
        }
        return .init(
            recordingID: recording.id, intervalID: interval.id, revision: recordingModel.telemetryRevision,
            refresh: refresh)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Codex telemetry").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Text(
                "Committed observations for one closed interval. Partial coverage; missing usage is unknown. Execution model and task allocation are unavailable."
            )
            .foregroundStyle(.secondary)
            if let selection {
                HStack {
                    Picker("Telemetry interval", selection: $intervalID) {
                        ForEach(
                            Array(recording.intervals.enumerated()).filter { $0.element.end != nil }, id: \.element.id
                        ) { index, interval in
                            Text("Interval \(index + 1)").tag(Optional(interval.id))
                        }
                    }
                    .frame(maxWidth: 260)
                    Button("Refresh telemetry", systemImage: "arrow.clockwise") { refresh += 1 }
                        .help("Reload committed observations for this interval")
                }
                Text("Oldest source write first · UTC").font(.callout).foregroundStyle(.secondary)
                Group {
                    if review.selection != selection {
                        ProgressView("Loading telemetry…")
                    } else {
                        switch review.state {
                        case .loading: ProgressView("Loading telemetry…")
                        case .failed:
                            Label(
                                "Telemetry unavailable. Use Refresh telemetry to retry.",
                                systemImage: "exclamationmark.triangle")
                        case .loaded(let observations):
                            if observations.isEmpty {
                                Text(
                                    "No committed Codex telemetry for this interval. Configuration and response usage are unavailable; this does not mean zero tokens."
                                )
                                .foregroundStyle(.secondary)
                            } else {
                                observationCards(observations)
                            }
                        }
                    }
                }
                .task(id: selection) { await load(selection) }
            } else {
                Text("No closed interval is available for telemetry review.").foregroundStyle(.secondary)
            }
        }
    }

    private func observationCards(_ observations: [RecordingTelemetryObservation]) -> some View {
        let responseUsageTurns = Set(
            observations.lazy.filter { $0.metadata.kind == "responseUsage" }
                .map { TurnIdentity($0.metadata) })
        return ForEach(observations) { observation in
            RecordingTelemetryObservationView(
                observation: observation,
                hasResponseUsage: responseUsageTurns.contains(TurnIdentity(observation.metadata)))
        }
    }

    private func load(_ selection: RecordingTelemetryReviewModel.Selection) async {
        await review.load(selection) {
            try await recordingModel.loadTelemetryReview(
                recordingID: selection.recordingID, intervalID: selection.intervalID)
        }
    }
}
