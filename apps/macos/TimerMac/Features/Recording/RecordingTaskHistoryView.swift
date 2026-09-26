import SwiftUI

struct RecordingTaskHistoryView: View {
    @Environment(RecordingModel.self) private var model
    let recordingID: UUID

    private var selections: [RecordingTaskSelection] {
        model.taskAttribution.selections.filter { $0.recordingID == recordingID }
    }

    var body: some View {
        if !selections.isEmpty {
            DisclosureGroup("Task selections · \(selections.count)") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(selections.reversed()) { selection in
                        HStack {
                            Text(
                                selection.stamp.wall,
                                format: Date.FormatStyle(date: .abbreviated, time: .standard, timeZone: .gmt))
                            Text(model.titleForTask(selection.taskID))
                        }
                    }
                    Text("UTC · User selections describe foreground work, not parallel agent activity.")
                        .foregroundStyle(.secondary)
                }
                .font(.callout).padding(.top, 6)
            }
        }
    }
}
