import SwiftUI

/// Display-only projection. A pending observation has no invented native receipt.
struct RecordingTimelineCodexObservation: Equatable, Identifiable {
    let metadata: CodexTelemetryContract.Metadata
    let sourceWrittenAt: Date
    let nativeReceivedAt: Date?
    var id: UUID { metadata.observationID }
    var isPending: Bool { nativeReceivedAt == nil }
}

enum RecordingTimelineItem: Identifiable {
    case event(RecordingTimeline.Entry)
    case codex(RecordingTimelineCodexObservation)

    var id: String {
        switch self {
        case .event(let entry): "event:\(entry.id)"
        case .codex(let observation): "codex:\(observation.id)"
        }
    }

    var timelineTime: Date {
        switch self {
        case .event(let entry): entry.timelineTime
        case .codex(let observation): observation.sourceWrittenAt
        }
    }

    static func merged(
        entries: [RecordingTimeline.Entry], saved: [RecordingTelemetryObservation],
        pending: [PendingCodexTelemetryObservation], recordingID: UUID, intervalID: UUID
    ) -> [Self] {
        var observations: [UUID: RecordingTimelineCodexObservation] = [:]
        for observation in pending
        where observation.metadata.recordingID == recordingID
            && observation.metadata.intervalID == intervalID
        {
            observations[observation.id] = .init(
                metadata: observation.metadata, sourceWrittenAt: observation.sourceWrittenAt,
                nativeReceivedAt: nil)
        }
        for observation in saved
        where observation.metadata.recordingID == recordingID
            && observation.metadata.intervalID == intervalID
        {
            observations[observation.id] = .init(
                metadata: observation.metadata, sourceWrittenAt: observation.sourceWrittenAt,
                nativeReceivedAt: observation.nativeReceivedAt)
        }
        let items =
            entries.map(Self.event)
            + observations.values.sorted { $0.id.uuidString < $1.id.uuidString }
            .map(Self.codex)
        // Keep the existing event order for equal timestamps; telemetry ties use observation identity.
        return items.enumerated().sorted {
            if $0.element.timelineTime != $1.element.timelineTime {
                return $0.element.timelineTime > $1.element.timelineTime
            }
            return $0.offset < $1.offset
        }.map(\.element)
    }
}

struct RecordingTimelineCodexEventsView: View {
    @Environment(RecordingModel.self) private var model
    let interval: RecordingTimeline.Interval
    let recordingID: UUID
    @State private var saved: [RecordingTelemetryObservation] = []
    @State private var loadedRecordingID: UUID?
    @State private var loadedIntervalID: UUID?
    @State private var failed = false
    @State private var refresh = 0

    private var selection: RecordingTelemetryReviewModel.Selection {
        .init(
            recordingID: recordingID, intervalID: interval.id,
            revision: model.telemetryRevision(recordingID: recordingID, intervalID: interval.id), refresh: refresh)
    }

    private var items: [RecordingTimelineItem] {
        RecordingTimelineItem.merged(
            entries: interval.entries,
            saved: Array(model.committedTelemetryPreviews.values)
                + (loadedRecordingID == recordingID && loadedIntervalID == interval.id ? saved : []),
            pending: Array(model.liveTelemetryObservations.values), recordingID: recordingID, intervalID: interval.id)
    }

    var body: some View {
        let items = items
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(items) { item in
                switch item {
                case .event(let entry):
                    RecordingTimelineEventView(entry: entry, isLast: item.id == items.last?.id)
                case .codex(let observation):
                    RecordingTimelineCodexEventView(observation: observation, isLast: item.id == items.last?.id)
                }
            }
            if failed {
                HStack {
                    Label("Saved Codex activity could not be loaded.", systemImage: "exclamationmark.triangle")
                    Button("Retry") { refresh += 1 }
                }
                .font(.callout).foregroundStyle(.secondary)
            }
            if !interval.hasObservations
                && !items.contains(where: {
                    if case .codex = $0 { return true }
                    return false
                })
            {
                Text("No app activity, notes or Codex metadata received in this interval.")
                    .font(.callout).foregroundStyle(.secondary)
                    .padding(.leading, 180)
            }
        }
        .task(id: selection) { await load(selection) }
    }

    private func load(_ selection: RecordingTelemetryReviewModel.Selection) async {
        do {
            let observations = try await model.loadTelemetryReview(
                recordingID: selection.recordingID, intervalID: selection.intervalID)
            guard !Task.isCancelled, self.selection == selection else { return }
            saved = observations
            loadedRecordingID = selection.recordingID
            loadedIntervalID = selection.intervalID
            failed = false
            // Retire the bridge only after these rows are installed in this view's state.
            model.didLoadTelemetry(observations)
        } catch {
            guard !Task.isCancelled, self.selection == selection else { return }
            failed = true
        }
    }
}

struct RecordingTimelineCodexEventView: View {
    let observation: RecordingTimelineCodexObservation
    var isLast = false
    private var metadata: CodexTelemetryContract.Metadata { observation.metadata }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .trailing, spacing: 4) {
                Text(
                    observation.sourceWrittenAt,
                    format: Date.FormatStyle(date: .omitted, time: .standard, timeZone: .gmt)
                )
                .monospacedDigit()
                Text(
                    observation.sourceWrittenAt,
                    format: Date.FormatStyle(date: .abbreviated, time: .omitted, timeZone: .gmt))
            }
            .font(.body).foregroundStyle(.secondary)
            .frame(width: 112, alignment: .trailing)
            .padding(.top, 5)

            VStack(spacing: 0) {
                Image(systemName: "terminal.fill")
                    .font(.body.bold()).foregroundStyle(.purple)
                    .frame(width: 36, height: 36)
                    .background(.purple.opacity(0.14), in: Circle())
                Rectangle().fill(isLast ? Color.clear : Color(nsColor: .separatorColor)).frame(width: 1)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 6) {
                Text(
                    metadata.threadName
                        ?? (metadata.kind == "turnConfiguration" ? "Codex configuration" : "Codex response usage")
                )
                .font(.title3.bold())
                if metadata.threadName != nil {
                    Text(metadata.kind == "turnConfiguration" ? "Codex configuration" : "Codex response usage")
                        .font(.callout).foregroundStyle(.secondary)
                }
                if metadata.kind == "turnConfiguration" {
                    Text(
                        "Configured model: \(metadata.configuredModel ?? "Unknown") · effort: \(metadata.configuredEffort ?? "Unknown")"
                    )
                } else if let usage = metadata.usage {
                    Text(
                        "\(usage.inputTokens.formatted()) input tokens · \(usage.outputTokens.formatted()) output tokens"
                    )
                } else {
                    Text("Response usage unknown / unavailable")
                }
                Text(observation.isPending ? "Pending — not yet saved" : "Saved")
                    .font(.callout).foregroundStyle(.secondary)
                DisclosureGroup("Details") {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Source write · UTC: \(CodexIntakeContract.timestamp(observation.sourceWrittenAt))")
                        if observation.isPending {
                            Text(
                                "Eligible metadata saves after Pause or Finish. Interrupted or expired intervals may remain unsaved."
                            )
                        }
                        if let receipt = observation.nativeReceivedAt {
                            Text("Native receipt · UTC: \(CodexIntakeContract.timestamp(receipt))")
                        }
                        Text("Execution model: unavailable. Partial coverage; missing usage is unknown.")
                        if let usage = metadata.usage {
                            Text("Individual response total: \(usage.totalTokens.formatted()) tokens")
                            Text("Cached input subset: \(usage.cachedInputTokens.formatted())")
                            Text(
                                "Cache-write input subset: \(usage.cacheWriteInputTokens.map { $0.formatted() } ?? "Unavailable")"
                            )
                            Text("Reasoning output subset: \(usage.reasoningOutputTokens.formatted())")
                            Text("Subsets are already included in input/output counts.")
                        }
                        Text("Turn \(metadata.turnID)")
                        if let responseID = metadata.responseID { Text("Response \(responseID)") }
                        Text("Session \(metadata.sessionID)")
                        Text("Thread \(metadata.threadID)")
                        Text("Source / version: \(metadata.source) / \(metadata.sourceVersion)")
                        Text("Observation \(observation.id.uuidString.lowercased())")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled).padding(.top, 4)
                }
                .font(.body).foregroundStyle(.secondary)
            }
            .padding(.top, 4).padding(.bottom, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }
}
