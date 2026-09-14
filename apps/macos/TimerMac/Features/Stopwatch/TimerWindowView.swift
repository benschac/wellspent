import SwiftUI

struct TimerWindowView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerWindowCoordinator.self) private var windows

    var body: some View {
        VStack(spacing: 0) {
            TimerWorkspaceNavigationView()
                .padding()
            Divider()
            ScrollView {
                VStack(spacing: 20) {
                    HStack {
                        Label("Timer", systemImage: "timer")
                            .font(.title2)
                            .bold()

                        Spacer()

                        ConnectionStatusView(state: model.syncStatus)
                    }

                    Text(model.backendProfileLabel)
                        .foregroundStyle(model.isProductionAPI ? .orange : .secondary)
                        .textSelection(.enabled)

                    Divider()

                    TimerReadoutView()
                    TimerControlsView()
                    Text(model.saveStatus)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if let errorMessage = model.errorMessage {
                        ErrorBannerView(message: errorMessage)
                    }

                    if let shortcutError = windows.focusShortcutError {
                        Label(shortcutError, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }

                    TimerWindowActionsView()

                    if let revision = model.latestRevision {
                        Text("Server revision \(revision)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding()
            }
        }
        .frame(minWidth: 520, minHeight: 500)
    }
}
