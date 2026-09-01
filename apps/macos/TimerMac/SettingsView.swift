import SwiftUI

struct SettingsView: View {
    @Environment(TimerModel.self) private var model
    @State private var apiBaseURL = ""
    @State private var accessToken = ""

    var body: some View {
        Form {
            Section("Connection") {
                TextField("API URL", text: $apiBaseURL)
                    .textContentType(.URL)

                SecureField("Bearer token", text: $accessToken)
                    .textContentType(.password)

                Text(
                    "The token is optional with the current development gateway and is stored in the macOS Keychain."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }

            Section {
                HStack {
                    Button("Reconnect", systemImage: "arrow.clockwise", action: reconnect)

                    Spacer()

                    Button("Save", action: save)
                        .buttonStyle(.borderedProminent)
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Timer Settings")
        .frame(minWidth: 440, minHeight: 220)
        .onAppear(perform: loadDrafts)
    }

    private func loadDrafts() {
        apiBaseURL = model.apiBaseURL
        accessToken = model.accessToken
    }

    private func reconnect() {
        model.applySettings(apiBaseURL: apiBaseURL, accessToken: accessToken)
    }

    private func save() {
        model.applySettings(apiBaseURL: apiBaseURL, accessToken: accessToken)
    }
}
