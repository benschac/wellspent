import SwiftUI

struct TimerControlsView: View {
    @Environment(TimerModel.self) private var model

    var body: some View {
        HStack {
            if model.isRunning {
                Button("Pause", systemImage: "pause.fill", action: model.pause)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.space, modifiers: [])
            } else {
                Button(
                    model.displayElapsedMilliseconds > 0 ? "Resume" : "Start",
                    systemImage: "play.fill",
                    action: model.startOrResume
                )
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.space, modifiers: [])
            }

            Button("Stop", systemImage: "stop.fill", action: model.stop)
                .keyboardShortcut(".", modifiers: .command)
                .disabled(!model.isRunning && model.displayElapsedMilliseconds == 0)
        }
        .controlSize(.large)
    }
}
