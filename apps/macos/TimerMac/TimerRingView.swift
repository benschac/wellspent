import SwiftUI

struct TimerRingView: View {
    @Environment(TimerModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle()
                .stroke(.white.opacity(0.18), lineWidth: 4)

            Circle()
                .trim(from: 0, to: model.progress)
                .stroke(
                    model.isOvertime ? Color.orange : Color.mint,
                    style: StrokeStyle(lineWidth: 4, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))

            Image(
                systemName: model.isOvertime
                    ? "checkmark" : !model.isRunning && model.displayElapsedMilliseconds > 0 ? "pause.fill" : "timer"
            )
            .contentTransition(.opacity)
            .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.2), value: model.isRunning)
            .font(.system(size: 19, weight: .medium))
            .foregroundStyle(.white)
        }
        .padding(3)
        .accessibilityHidden(true)
    }
}
