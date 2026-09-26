import SwiftUI

struct RecordingTaskControlsView: View {
    @Environment(RecordingModel.self) private var model
    @State private var showingNewTask = false
    @State private var title = ""

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var titleIsTooLong: Bool { trimmedTitle.utf8.count > 500 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Menu {
                    Button("Unassigned") { model.selectRecordingTask(nil) }
                    ForEach(model.taskAttribution.tasks) { task in
                        Button(task.title) { model.selectRecordingTask(task.id) }
                    }
                } label: {
                    Label(model.activeTaskTitle, systemImage: "tag")
                }
                .disabled(!model.canSelectRecordingTask)
                .accessibilityLabel("Current recording task")
                Button("New task…", systemImage: "plus") { showingNewTask = true }
                    .disabled(!model.canEditTasks)
                Spacer()
                Text("Tasks persist across recordings")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Text("Choose a task while recording. Agent activity stays unassigned until you assign it in review.")
                .font(.callout).foregroundStyle(.secondary)
            if let message = model.taskErrorMessage {
                Label(message, systemImage: "exclamationmark.circle")
                    .foregroundStyle(.orange).textSelection(.enabled)
                HStack {
                    Button("Retry task save / load", action: model.retryTaskAction)
                    if model.hasPendingTaskAction {
                        Button("Clear retry and reload", action: model.discardTaskAction)
                    }
                }
                .disabled(!model.canAct)
            }
        }
        .sheet(isPresented: $showingNewTask) {
            VStack(alignment: .leading, spacing: 16) {
                Text("New task").font(.title2.bold())
                TextField("Task title", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(create)
                if titleIsTooLong {
                    Text("Task title exceeds the 500-byte limit.")
                        .font(.callout).foregroundStyle(.orange)
                }
                Text("Saved on this Mac. Select this task in any recording.")
                    .font(.callout).foregroundStyle(.secondary)
                HStack {
                    Button("Cancel") { showingNewTask = false }
                        .keyboardShortcut(.cancelAction)
                    Spacer()
                    Button("Create task", action: create)
                        .keyboardShortcut(.defaultAction)
                        .disabled(trimmedTitle.isEmpty || titleIsTooLong || !model.canEditTasks)
                }
            }
            .padding(24).frame(width: 420)
        }
    }

    private func create() {
        guard !trimmedTitle.isEmpty, !titleIsTooLong, model.canEditTasks else { return }
        model.createRecordingTask(title: trimmedTitle)
        title = ""
        showingNewTask = false
    }
}
