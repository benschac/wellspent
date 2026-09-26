import SwiftUI

struct RecordingTimelineEventView: View {
    let entry: RecordingTimeline.Entry
    var isLast = false

    private var color: Color {
        switch entry.event.kind {
        case .application: .blue
        case .agentCompletion: .purple
        case .note: .teal
        case .interrupt, .suspend: .orange
        default: .secondary
        }
    }

    private var symbol: String {
        switch entry.event.kind {
        case .application: "app.fill"
        case .agentCompletion: "terminal.fill"
        case .note: "text.bubble.fill"
        case .start, .resume: "play.fill"
        case .pause, .suspend: "pause.fill"
        case .finish: "stop.fill"
        case .interrupt: "exclamationmark"
        }
    }

    private var title: String {
        let event = entry.event
        switch event.kind {
        case .application: return event.applicationIdentity?.localizedName ?? event.sourceLabel
        case .agentCompletion: return event.sourceLabel
        case .note: return event.workNote == nil ? "Note" : "Codex note · outcome unverified"
        case .start: return "Recording started"
        case .resume: return "Recording resumed"
        case .pause: return "Recording paused"
        case .finish: return "Recording finished"
        case .suspend: return "Recording suspended"
        case .interrupt: return "Recording interrupted"
        }
    }

    var body: some View {
        let event = entry.event
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .trailing, spacing: 4) {
                Text(entry.timelineTime, format: Date.FormatStyle(date: .omitted, time: .standard, timeZone: .gmt))
                    .monospacedDigit()
                Text(entry.timelineTime, format: Date.FormatStyle(date: .abbreviated, time: .omitted, timeZone: .gmt))
            }
            .font(.body).foregroundStyle(.secondary)
            .frame(width: 112, alignment: .trailing)
            .padding(.top, 5)

            VStack(spacing: 0) {
                Image(systemName: symbol)
                    .font(.body.bold())
                    .foregroundStyle(color)
                    .frame(width: 36, height: 36)
                    .background(color.opacity(0.14), in: Circle())
                Rectangle().fill(isLast ? Color.clear : Color(nsColor: .separatorColor))
                    .frame(width: 1)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.title3.bold())
                if event.applicationIdentity != nil {
                    Text("Foreground application").font(.body).foregroundStyle(.secondary)
                } else if !event.text.isEmpty {
                    Text(event.text).font(.body).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let agent = event.agentMetadata {
                    Text(
                        "\(agent.metadata.toolName ?? "Turn stop") · reported result: \(agent.metadata.reportedResult)"
                    )
                    .font(.body).foregroundStyle(.secondary)
                }
                if event.kind.isObservation {
                    RecordingAttributionView(event: event)
                }
                DisclosureGroup("Details") {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(entry.timeSource.label)
                        if let application = event.applicationIdentity {
                            Text(application.disclosure)
                        }
                        if entry.timelineTime != event.stamp.wall {
                            Text(
                                "Saved locally: \(event.stamp.wall.formatted(Date.FormatStyle(date: .abbreviated, time: .standard, timeZone: .gmt))) UTC"
                            )
                        }
                        if let agent = event.agentMetadata {
                            Text("Thread \(agent.metadata.threadID) · \(agent.metadata.kind)")
                            Text("Model, reasoning effort and token usage are unavailable from this capture source.")
                        }
                        if event.workNote != nil {
                            Text("Explicitly submitted note; completion and focused time are unverified.")
                        }
                        Text("Event \(event.id.uuidString)")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(.top, 4)
                }
                .font(.body).foregroundStyle(.secondary)
            }
            .padding(.top, 4)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }
}
