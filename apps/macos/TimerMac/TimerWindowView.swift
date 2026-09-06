import SwiftUI

struct TimerWindowView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerSidebarController.self) private var sidebar

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

                Button(action: sidebar.showSettings) {
                    Label("Settings", systemImage: "gearshape")
                }
            }
        }
        .padding()
        .frame(minWidth: 440, minHeight: 360)
    }
}
