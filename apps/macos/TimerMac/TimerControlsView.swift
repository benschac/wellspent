import SwiftUI

struct TimerControlsView: View {
    @Environment(TimerModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack {
            Button(action: toggleTimer) {
                Label(
                    model.isRunning ? "Pause" : model.displayElapsedMilliseconds > 0 ? "Resume" : "Start",
                    systemImage: model.isRunning ? "pause.fill" : "play.fill"
                )
                .contentTransition(.opacity)
                .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.2), value: model.isRunning)
                .frame(minWidth: 76)
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.space, modifiers: [])

            Button("Reset", systemImage: "arrow.counterclockwise", action: model.reset)
                .keyboardShortcut(".", modifiers: .command)
                .disabled(!model.isRunning && model.displayElapsedMilliseconds == 0)
        }
        .controlSize(.large)
    }

    private func toggleTimer() {
        if model.isRunning { model.pause() } else { model.startOrResume() }
    }
}
