import SwiftUI

struct FocusSignInView: View {
    @Environment(FocusAuthModel.self) private var auth
    @Environment(FocusModel.self) private var focus
    @State private var confirmAccountChange = false
    @State private var showingForm = false

    var body: some View {
        HStack {
            if auth.isRestoring {
                ProgressView().controlSize(.small)
                Text("Opening your account…")
            } else {
                Button("Sign in") {
                    if auth.user != nil && focus.hasAccountWork {
                        confirmAccountChange = true
                    } else {
                        showingForm = true
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(focus.isBusy || auth.isSigningIn)
            }
        }
        .sheet(isPresented: $showingForm) { FocusSignInForm() }
        .confirmationDialog("Keep your work with the same account", isPresented: $confirmAccountChange) {
            Button("Continue to Sign In") { showingForm = true }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "Sign in to the same account to keep drafts and retry unconfirmed saves. Choosing another account discards this Mac’s drafts and pending requests; an unconfirmed save may already be on the server."
            )
        }
    }
}
