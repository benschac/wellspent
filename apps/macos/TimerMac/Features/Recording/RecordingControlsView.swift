import SwiftUI

struct RecordingControlsView: View {
    @Environment(RecordingModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let message = model.errorMessage {
                Text(message).foregroundStyle(.orange).textSelection(.enabled)
                Button("Retry local save / load", action: model.retry).disabled(model.isBusy)
            }
            HStack {
                if let current = model.current {
                    if current.status == .recording {
                        Button("Pause recording", systemImage: "pause", action: model.pause)
                    } else {
                        Button("Resume recording", systemImage: "play.fill", action: model.resume)
                            .buttonStyle(.borderedProminent)
                    }
                    Button("Finish recording", systemImage: "stop", action: model.finish)
                } else {
                    Button(
                        "Start recording", systemImage: "apps.macwindow",
                        action: model.startForegroundApplicationRecording
                    )
                    .buttonStyle(.borderedProminent)
                }
                Menu("Developer samples", systemImage: "hammer") {
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
                .font(.body)
                .labelStyle(.iconOnly)
                .help("Developer samples")
            }
            .disabled(!model.canAct)
        }
    }
}
