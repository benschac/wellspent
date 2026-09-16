import SwiftUI

struct RecordingControlsView: View {
    @Environment(RecordingModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(model.saveStatus).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier(
                "recording-save-status")
            if let message = model.errorMessage {
                Text(message).foregroundStyle(.orange).textSelection(.enabled)
                Button("Retry local save / load", action: model.retry).disabled(model.isBusy)
            }
            HStack {
                if let current = model.current {
                    Text(current.status.rawValue.capitalized)
                    if current.status == .recording {
                        Button("Pause", systemImage: "pause", action: model.pause)
                    } else {
                        Button("Resume", systemImage: "play", action: model.resume)
                    }
                    Button("Finish", systemImage: "stop", action: model.finish)
                } else {
                    Button(
                        "Start recording", systemImage: "apps.macwindow",
                        action: model.startForegroundApplicationRecording)
                }
            }
            .disabled(!model.canAct)
            Menu("Sample controls", systemImage: "hammer") {
                Button("Start sample recording", action: model.startRecording)
                    .disabled(!model.canAct || model.current != nil)
                Button("Simulate coverage gap", action: model.simulateGap)
                    .disabled(!model.canAct || !model.acceptingEvents)
                Divider()
                Button("Add sample app event", action: model.addApplicationSample)
                    .disabled(!model.canAct || !model.acceptingEvents)
                Button("Add sample agent report", action: model.addAgentSample)
                    .disabled(!model.canAct || !model.acceptingEvents)
                Button("Add sample note", action: model.addNoteSample)
                    .disabled(!model.canAct || !model.acceptingEvents)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .font(.caption)
        }
    }
}
