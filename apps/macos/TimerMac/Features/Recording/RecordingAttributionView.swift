import SwiftUI

/// Interpretation is separate from the immutable event and its capture authorization.
struct RecordingAttributionView: View {
    @Environment(RecordingModel.self) private var model
    let event: RecordingEvent

    private var history: [RecordingAttributionOperation] {
        model.taskAttribution.operations.filter { $0.command.eventID == event.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(
                    event.kind == .application && model.taskAttribution.assignment(for: event) == .automatic
                        ? "Recording selections" : model.taskTitle(for: event), systemImage: "tag")
                Menu("Assign task") {
                    Button("Unassigned") { model.correctRecordingTask(event, assignment: .unassigned) }
                    ForEach(model.taskAttribution.tasks) { task in
                        Button(task.title) { model.correctRecordingTask(event, assignment: .task(task.id)) }
                    }
                    if event.kind == .application {
                        Divider()
                        Button("Use recording selections") {
                            model.correctRecordingTask(event, assignment: .automatic)
                        }
                    }
                }
                .disabled(!model.canEditTasks)
            }
            .font(.callout)
            if event.kind == .application,
                let recording = model.recordings.first(where: { $0.id == event.recordingID })
            {
                let segments = model.taskAttribution.foregroundSegments(for: event, in: recording)
                ForEach(segments) { segment in
                    HStack(alignment: .firstTextBaseline) {
                        Text(
                            segment.start.wall,
                            format: Date.FormatStyle(date: .omitted, time: .standard, timeZone: .gmt))
                        Text(model.titleForTask(segment.taskID))
                        if let duration = segment.duration {
                            Text(
                                Duration.seconds(duration).formatted(
                                    .units(allowed: [.hours, .minutes, .seconds], width: .abbreviated)))
                        } else {
                            Text("End unconfirmed")
                        }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                Text("Foreground exposure · assignment applies to the whole original span")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if !history.isEmpty {
                DisclosureGroup("Assignment history · \(history.count)") {
                    ForEach(history.reversed()) { operation in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.assignmentTitle(operation.command.assignment))
                            Text(
                                operation.command.createdAt,
                                format: Date.FormatStyle(date: .abbreviated, time: .standard, timeZone: .gmt)
                            )
                            .foregroundStyle(.secondary)
                            if operation.command.undoesOperationID != nil { Text("Undo · original evidence preserved") }
                            Button("Undo this assignment") { model.undoRecordingTask(operation) }
                                .disabled(
                                    !model.canEditTasks
                                        || model.taskAttribution.head(eventID: event.id)?.id != operation.id)
                        }
                        .padding(.vertical, 4)
                    }
                }
                .font(.callout)
            }
        }
    }
}
