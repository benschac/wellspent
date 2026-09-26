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
                    Button("Unassigned") { model.tasks.selectRecordingTask(nil) }
                    ForEach(model.tasks.taskAttribution.tasks) { task in
                        Button(task.title) { model.tasks.selectRecordingTask(task.id) }
                    }
                } label: {
                    Label(model.tasks.activeTaskTitle, systemImage: "tag")
                }
                .disabled(!model.tasks.canSelectRecordingTask)
                .accessibilityLabel("Current recording task")
                Button("New task…", systemImage: "plus") { showingNewTask = true }
                    .disabled(!model.tasks.canEditTasks)
                Spacer()
                Text("Tasks persist across recordings")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Text("Choose a task while recording. Agent activity stays unassigned until you assign it in review.")
                .font(.callout).foregroundStyle(.secondary)
            if let message = model.tasks.taskErrorMessage {
                Label(message, systemImage: "exclamationmark.circle")
                    .foregroundStyle(.orange).textSelection(.enabled)
                HStack {
                    Button("Retry task save / load", action: model.tasks.retryTaskAction)
                    if model.tasks.hasPendingTaskAction {
                        Button("Clear retry and reload", action: model.tasks.discardTaskAction)
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
                        .disabled(trimmedTitle.isEmpty || titleIsTooLong || !model.tasks.canEditTasks)
                }
            }
            .padding(24).frame(width: 420)
        }
    }

    private func create() {
        guard !trimmedTitle.isEmpty, !titleIsTooLong, model.tasks.canEditTasks else { return }
        model.tasks.createRecordingTask(title: trimmedTitle)
        title = ""
        showingNewTask = false
    }
}
