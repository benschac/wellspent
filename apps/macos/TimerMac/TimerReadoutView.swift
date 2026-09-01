import SwiftUI

struct TimerReadoutView: View {
    @Environment(TimerModel.self) private var model

    var body: some View {
        VStack {
            Text(model.isOvertime ? "Time complete" : "Focus remaining")
                .font(.headline)
                .foregroundStyle(.secondary)

            Text(model.menuBarTitle)
                .font(.system(.largeTitle, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .contentTransition(.numericText())
                .accessibilityLabel(model.accessibilityTimerLabel)
                .accessibilityAddTraits(.updatesFrequently)

            ProgressView(value: model.progress)
                .accessibilityLabel("Focus progress")
                .accessibilityValue(
                    Text(
                        model.progress,
                        format: .percent.precision(.fractionLength(0))
                    )
                )
        }
    }
}
