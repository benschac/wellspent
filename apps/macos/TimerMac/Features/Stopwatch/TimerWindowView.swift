import SwiftUI

struct TimerWindowView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerSidebarController.self) private var sidebar
    @Environment(TimerWindowCoordinator.self) private var windows

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 28) {
                TimerReadoutView()
                TimerControlsView()
                Spacer(minLength: 16)
                VStack(alignment: .trailing, spacing: 6) {
                    ConnectionStatusView(state: model.syncStatus)
                    Text(model.saveStatus).font(.callout).foregroundStyle(.secondary)
                }
                TimerWindowActionsView()
            }
            .padding(24)

            if let controls = sidebar.recordingControls,
                let message = controls.errorMessage
            {
                ErrorBannerView(message: message).padding(.horizontal, 24)
            }
            if let errorMessage = model.errorMessage {
                ErrorBannerView(message: errorMessage).padding(.horizontal, 24)
            }
            if let shortcutError = windows.focusShortcutError {
                Label(shortcutError, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange).padding(.horizontal, 24)
            }

            Divider()
            RecordingWindowView()
                .padding(.top, 20)
        }
        .frame(minWidth: 980, minHeight: 700)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .preferredColorScheme(.dark)
    }
}
