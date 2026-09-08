import SwiftUI

struct FocusSignInForm: View {
    @Environment(FocusAuthModel.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var submitted = false
    @FocusState private var emailFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Sign in to Focus").font(.title2.weight(.semibold))
            Text("Use the same email and password as Focus on the web.")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 6) {
                Text("Email").font(.callout)
                TextField("you@example.com", text: $email)
                    .textContentType(.username)
                    .focused($emailFocused)
                Text("Password").font(.callout).padding(.top, 6)
                SecureField("Password", text: $password).textContentType(.password)
            }
            .textFieldStyle(.roundedBorder)
            .disabled(auth.isSigningIn)
            .onSubmit(signIn)
            if submitted, let message = auth.message {
                Text(message).font(.callout).foregroundStyle(.secondary)
            }
            HStack {
                Button("Cancel", role: .cancel) {
                    auth.cancelSignIn()
                    password = ""
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
                Spacer()
                if auth.isSigningIn { ProgressView().controlSize(.small) }
                Button(auth.isSigningIn ? "Signing in…" : "Sign in", action: signIn)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(
                        auth.isSigningIn || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || password.isEmpty)
            }
        }
        .padding(24)
        .frame(width: 360)
        .onAppear {
            email = auth.user?.email ?? ""
            emailFocused = true
        }
        .onDisappear {
            password = ""
            auth.cancelSignIn()
        }
        .interactiveDismissDisabled(auth.isSigningIn)
    }

    private func signIn() {
        guard !auth.isSigningIn, !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty
        else { return }
        submitted = true
        auth.signIn(email: email, password: password) { success in
            if success { dismiss() }
        }
        password = ""
    }
}
