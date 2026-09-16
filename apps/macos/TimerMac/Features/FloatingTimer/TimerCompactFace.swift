import LiquidUI
import SwiftUI

struct TimerCompactFace: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerSidebarController.self) private var sidebar
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let geometry: TimerWidgetGeometry

    var body: some View {
        ZStack(alignment: .topLeading) {
            TimerRingView().frame(width: 48, height: 48)
                .position(geometry.ring)
            VStack(spacing: 7) {
                Text(model.menuBarTitle)
                    .font(.system(size: 17, weight: .medium, design: .rounded))
                    .monospacedDigit()
                Text(statusText)
                    .contentTransition(.opacity)
                    .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.2), value: model.isRunning)
                    .font(.system(size: 8, weight: .semibold))
                    .tracking(1.5)
                    .foregroundStyle(.white.opacity(0.6))
            }
            .fixedSize()
            .position(geometry.label)
            .opacity(geometry.contentOpacity)
        }
    }

    private var statusText: String {
        if let controls = sidebar.recordingControls {
            if controls.errorMessage != nil || controls.recording.errorMessage != nil { return "REC ERROR" }
            if controls.isStarting { return "STARTING" }
            if controls.recording.canCaptureForegroundApplications { return "RECORDING" }
            if controls.recording.isBusy { return "SAVING" }
            if model.isRunning { return "REC PAUSED" }
        }
        if model.syncStatus != .connected { return model.syncStatus.label.uppercased() }
        if model.pendingCommandCount > 0 { return "SAVING" }
        return model.isRunning ? "FOCUS" : model.displayElapsedMilliseconds > 0 ? "PAUSED" : "READY"
    }

}
