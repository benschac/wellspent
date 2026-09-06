import SwiftUI

struct TimerCompactFace: View {
    @Environment(TimerModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let geometry: TimerSidebarGeometry

    var body: some View {
        ZStack(alignment: .topLeading) {
            TimerRingView().frame(width: 48, height: 48)
                .position(geometry.ring)
            VStack(spacing: 7) {
                Text(model.menuBarTitle)
                    .font(.system(size: 17, weight: .medium, design: .rounded))
                    .monospacedDigit()
                Text(
                    model.isOvertime
                        ? "DONE" : model.isRunning ? "FOCUS" : model.displayElapsedMilliseconds > 0 ? "PAUSED" : "READY"
                )
                .contentTransition(.opacity)
                .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.2), value: model.isRunning)
                .font(.system(size: 8, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(.white.opacity(0.6))
            }
            .fixedSize()
            .position(geometry.label)
        }
    }
}
