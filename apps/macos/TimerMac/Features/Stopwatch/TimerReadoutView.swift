import SwiftUI

struct TimerReadoutView: View {
    @Environment(TimerModel.self) private var model

    var body: some View {
        VStack {
            Text("Focus elapsed")
                .font(.headline)
                .foregroundStyle(.secondary)

            Text(model.menuBarTitle)
                .font(.system(.largeTitle, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .contentTransition(.numericText())
                .accessibilityLabel(model.accessibilityTimerLabel)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }
}
