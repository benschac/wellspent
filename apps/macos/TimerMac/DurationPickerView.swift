import SwiftUI

struct DurationPickerView: View {
    @Environment(TimerModel.self) private var model

    var body: some View {
        @Bindable var model = model

        Picker("Focus duration", selection: $model.selectedDurationMinutes) {
            ForEach(TimerModel.durationOptions, id: \.self) { minutes in
                Text("\(minutes) min")
                    .tag(minutes)
            }
        }
        .pickerStyle(.menu)
        .disabled(model.isRunning)
        .help(
            model.isRunning
                ? "Pause or stop the timer before changing its duration."
                : "Choose the local countdown duration."
        )
    }
}
