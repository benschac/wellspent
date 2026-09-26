import SwiftUI

struct RecordingTelemetryObservationView: View {
    let observation: RecordingTelemetryObservation
    var hasResponseUsage = false
    private var metadata: CodexTelemetryContract.Metadata { observation.metadata }

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                if metadata.kind == "turnConfiguration" {
                    field("Configured model", metadata.configuredModel ?? "Unknown / unavailable")
                    field("Configured effort", metadata.configuredEffort ?? "Unknown / unavailable")
                    Text(
                        "Turn settings only. Response usage is reported separately; a setting does not establish the execution model."
                    )
                    .font(.callout).foregroundStyle(.secondary)
                    if !hasResponseUsage {
                        Text(
                            "Response usage: unavailable. No committed response usage matches this turn in this interval."
                        )
                        .font(.callout).foregroundStyle(.secondary)
                    }
                } else if let usage = metadata.usage {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 24) {
                            metric("Input tokens", usage.inputTokens)
                            metric("Output tokens", usage.outputTokens)
                            metric("Total tokens", usage.totalTokens)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            metric("Input tokens", usage.inputTokens)
                            metric("Output tokens", usage.outputTokens)
                            metric("Total tokens", usage.totalTokens)
                        }
                    }
                    field("Cached input subset", usage.cachedInputTokens.formatted())
                    field(
                        "Cache-write input subset", usage.cacheWriteInputTokens.map { $0.formatted() } ?? "Unavailable")
                    field("Reasoning output subset", usage.reasoningOutputTokens.formatted())
                    Text(
                        "Subsets are included in the reported input/output counts, not added to the total. Execution model: unavailable."
                    )
                    .font(.callout).foregroundStyle(.secondary)
                } else {
                    Text("Response usage unavailable").foregroundStyle(.secondary)
                }
                field("Turn", metadata.turnID)
                if let responseID = metadata.responseID { field("Response", responseID) }
                field("Source / version", "\(metadata.source) / \(metadata.sourceVersion)")
                field("Source write · UTC", CodexIntakeContract.timestamp(observation.sourceWrittenAt))
                field("Native receipt · UTC", CodexIntakeContract.timestamp(observation.nativeReceivedAt))
                Label("Partial coverage", systemImage: "circle.lefthalf.filled").font(.callout)
                DisclosureGroup("Observation details") {
                    VStack(alignment: .leading, spacing: 6) {
                        field("Observation", observation.id.uuidString.lowercased())
                        field("Session", metadata.sessionID)
                        field("Thread", metadata.threadID)
                        field("Root turn", metadata.rootTurnID)
                        field("Helper receipt (source timestamp)", metadata.helperReceivedAt)
                        Text("Time basis: source write. Reader gap details are not stored in this review.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            .padding(6)
        } label: {
            Text(metadata.kind == "turnConfiguration" ? "Turn configuration" : "Individual response usage")
                .font(.headline).accessibilityAddTraits(.isHeader)
        }
    }

    private func field(_ title: String, _ value: String) -> some View {
        LabeledContent(title) { Text(value).multilineTextAlignment(.trailing) }
            .font(.callout)
            .accessibilityElement(children: .combine)
    }

    private func metric(_ title: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            Text(value.formatted()).font(.title3.monospacedDigit())
        }
        .accessibilityElement(children: .combine)
    }
}
