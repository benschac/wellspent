import SwiftUI

struct TimerControlsView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerSidebarController.self) private var sidebar
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack {
            Button(action: sidebar.toggleTimer) {
                Label(
                    sidebar.recordingControls?.isStarting == true
                        ? "Cancel start"
                        : model.isRunning ? "Pause" : model.displayElapsedMilliseconds > 0 ? "Resume" : "Start",
                    systemImage: model.isRunning || sidebar.recordingControls?.isStarting == true
                        ? "pause.fill" : "play.fill"
                )
                .contentTransition(.opacity)
                .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.2), value: model.isRunning)
                .frame(minWidth: 76)
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.space, modifiers: [])
            .help("Start or resume local app recording with the timer. Pause stops new capture.")
            .disabled(
                sidebar.recordingControls?.isBusy == true && sidebar.recordingControls?.isStarting == false
                    && !model.isRunning)

            Button("Reset", systemImage: "arrow.counterclockwise", action: model.reset)
                .keyboardShortcut(".", modifiers: .command)
                .disabled(!model.isRunning && model.displayElapsedMilliseconds == 0)
        }
        .controlSize(.large)
    }
}
