import SwiftUI

struct TimerWindowView: View {
    @Environment(TimerModel.self) private var model

    var body: some View {
        VStack {
            HStack {
                Label("Timer", systemImage: "timer")
                    .font(.title2)
                    .bold()

                Spacer()

                ConnectionStatusView(state: model.connectionState)
            }

            Spacer()

            TimerReadoutView()
            DurationPickerView()
            TimerControlsView()

            if let errorMessage = model.errorMessage {
                ErrorBannerView(message: errorMessage)
            }

            Spacer()

            HStack {
                if let revision = model.latestRevision {
                    Text("Server revision \(revision)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                SettingsLink {
                    Label("Settings", systemImage: "gearshape")
                }
            }
        }
        .padding()
        .frame(minWidth: 440, minHeight: 360)
    }
}
