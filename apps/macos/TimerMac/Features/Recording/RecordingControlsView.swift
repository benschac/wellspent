import SwiftUI

struct RecordingControlsView: View {
    @Environment(RecordingModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(model.saveStatus).font(.headline).accessibilityIdentifier("recording-save-status")
            if let message = model.errorMessage {
                Text(message).foregroundStyle(.orange).textSelection(.enabled)
                Button("Retry local save / load", action: model.retry).disabled(model.isBusy)
            }
            HStack {
                if let current = model.current {
                    Text(current.status.rawValue.capitalized)
                    if current.status == .recording {
                        Button("Pause", systemImage: "pause", action: model.pause)
                        Button("Simulate coverage gap", action: model.simulateGap)
                    } else {
                        Button("Resume", systemImage: "play", action: model.resume)
                    }
                    Button("Finish", systemImage: "stop", action: model.finish)
                } else {
                    Button("Start sample recording", systemImage: "record.circle", action: model.startRecording)
                    Button(
                        "Start foreground app recording", systemImage: "apps.macwindow",
                        action: model.startForegroundApplicationRecording)
                }
            }
            .disabled(!model.canAct)
            HStack {
                Button("Add sample app event", action: model.addApplicationSample)
                Button("Add sample agent report", action: model.addAgentSample)
                Button("Add sample note", action: model.addNoteSample)
            }
            .disabled(!model.canAct || !model.acceptingEvents)
            Text(
                "Foreground-app recording stores app name, bundle ID, and PID only. It never reads windows, documents, input, or screen contents. Local Codex intake requires an explicit pairing."
            )
            .font(.caption).foregroundStyle(.secondary)
        }
    }
}
