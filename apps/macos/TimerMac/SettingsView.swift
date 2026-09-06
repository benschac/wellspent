import SwiftUI

struct SettingsView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerSidebarController.self) private var sidebar
    @State private var apiBaseURL = ""
    @State private var accessToken = ""

    var body: some View {
        @Bindable var sidebar = sidebar

        Form {
            Section("Timer") {
                DurationPickerView()
                HStack {
                    Button(
                        "Open Timer Window", systemImage: "arrow.up.left.and.arrow.down.right",
                        action: sidebar.showMainWindow)
                    Spacer()
                    Button("Reset Timer", action: model.stop)
                        .disabled(!model.isRunning && model.displayElapsedMilliseconds == 0)
                }
            }

            Section("Floating sidebar") {
                Toggle("Magnetic screen edges", isOn: $sidebar.magneticEdges)
                Toggle("Lock position", isOn: $sidebar.isPositionLocked)
                HStack {
                    Button(sidebar.isVisible ? "Hide Widget" : "Show Widget", action: sidebar.toggleVisibility)
                    Spacer()
                    Button("Reset Position", action: sidebar.resetPosition)
                }
                Text(
                    "Drag the timer to move it. Drop near an edge to attach, or farther away to float. Click to start or pause."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }

            Section("Connection") {
                ConnectionStatusView(state: model.connectionState)
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
        .frame(minWidth: 440, minHeight: 560)
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
