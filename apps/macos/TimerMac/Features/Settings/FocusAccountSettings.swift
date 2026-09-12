import SwiftUI

struct FocusAccountSettings: View {
    @Environment(FocusAuthModel.self) private var auth
    @Environment(FocusModel.self) private var focus
    @State private var confirmSignOut = false

    var body: some View {
        if let user = auth.user {
            LabeledContent("Account", value: user.email ?? "Your Focus account")
            if auth.needsSignIn { FocusSignInView() }
            Button("Sign out", role: .destructive) {
                if focus.hasAccountWork { confirmSignOut = true } else { signOut() }
            }
            .disabled(focus.isBusy || auth.isSigningIn || auth.isRestoring)
            .confirmationDialog("Sign out and discard local work?", isPresented: $confirmSignOut) {
                Button("Sign Out and Discard", role: .destructive, action: signOut)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(
                    "Unsaved intentions, notes, recaps and pending requests will be removed from this Mac. An unconfirmed save may already be on the server. Cancel and retry it first if you need to confirm the outcome."
                )
            }
        } else {
            FocusSignInView()
        }
        if let message = auth.message { Text(message).font(.footnote).foregroundStyle(.secondary) }
    }

    private func signOut() { Task { await auth.signOut() } }
}
