import SwiftUI

struct FocusPanelNotices: View {
    @Environment(FocusAuthModel.self) private var auth
    @Environment(FocusModel.self) private var focus
    @Environment(TimerSidebarController.self) private var sidebar

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = sidebar.focusShortcutError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }
            if let message = auth.message {
                Text(message).foregroundStyle(.secondary)
            }
            if auth.needsSignIn && !focus.sessions.isEmpty { FocusSignInView() }
            if let error = focus.errorMessage {
                Label(error, systemImage: "exclamationmark.circle")
                    .foregroundStyle(.secondary).textSelection(.enabled)
            }
            if focus.pendingMutation != nil {
                HStack {
                    Text(
                        "An unconfirmed save is held while this app stays open. Retry before quitting or changing accounts."
                    )
                    Button("Retry Save", action: retry).disabled(focus.isBusy || !auth.canAccess)
                }
            }
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(
            .top,
            auth.message != nil || focus.errorMessage != nil || sidebar.focusShortcutError != nil
                || focus.pendingMutation != nil ? 12 : 0)
    }

    private func retry() { Task { await focus.retrySave() } }
}
