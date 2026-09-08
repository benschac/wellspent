import SwiftUI

struct SettingsDetailView: View {
    @Environment(TimerModel.self) private var model
    @Environment(TimerSidebarController.self) private var sidebar
    @State private var apiBaseURL = ""
    @State private var stopwatchAccessToken = ""
    @Environment(FocusModel.self) private var focus
    @State private var confirmBackendChange = false
    let selectedCategory: SettingsCategory

    var body: some View {
        @Bindable var sidebar = sidebar

        Form {
            if selectedCategory == .accounts {
                Section("Focus sessions") {
                    Button("Open Focus", systemImage: "scope", action: sidebar.showFocusWindow)
                    Text("Global shortcut: ⌃⌥⌘F (Control–Option–Command–F)").font(.footnote)
                    if let error = sidebar.focusShortcutError { Text(error).foregroundStyle(.orange) }
                    FocusAccountSettings()
                }
            }
            if selectedCategory == .timer {
                Section("Timer") {
                    HStack {
                        Button(
                            "Open Timer Window", systemImage: "arrow.up.left.and.arrow.down.right",
                            action: sidebar.showMainWindow)
                        Spacer()
                        Button("Reset Timer", action: model.reset)
                            .disabled(!model.isRunning && model.displayElapsedMilliseconds == 0)
                    }
                }
            }

            if selectedCategory == .floatingSidebar {
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
            }

            if selectedCategory == .connection {
                Section("Connection") {
                    Text(model.backendProfileLabel)
                    if model.isLaunchProfile {
                        Text("The API URL is fixed for this launch. Quit and use dev:local or dev:prod-api to switch.")
                            .font(.footnote)
                    }
                    ConnectionStatusView(state: model.syncStatus)
                    Text(model.saveStatus)
                        .font(.footnote)
                    LabeledContent("Active socket") {
                        Text(model.diagnosticEndpoint).textSelection(.enabled)
                    }
                    LabeledContent("Pending actions", value: String(model.pendingCommandCount))
                    LabeledContent("Unconfirmed actions", value: String(model.unconfirmedCommandCount))
                    Text(
                        "Queued actions are held only while this app is open; changing the server or token clears them. Attempted sends with unknown outcomes are not automatically replayed."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    if let errorMessage = model.errorMessage {
                        Text(errorMessage).font(.footnote).foregroundStyle(.orange)
                    }
                    TextField("API URL", text: $apiBaseURL)
                        .textContentType(.URL)
                        .disabled(model.isLaunchProfile)

                    SecureField("Stopwatch bearer token", text: $stopwatchAccessToken)
                        .textContentType(.password)

                    Text("Optional. Stored in the macOS Keychain and used only by the shared stopwatch connection.")
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
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .onAppear(perform: loadDrafts)
        .task { await sidebar.prepareFocus() }
        .confirmationDialog("Change backend and discard local Focus work?", isPresented: $confirmBackendChange) {
            Button("Change Backend", role: .destructive, action: apply)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "Drafts and pending requests belong to the current account. An unconfirmed save may already be on the server. Cancel to retry it before switching."
            )
        }
    }

    private func loadDrafts() {
        apiBaseURL = model.apiBaseURL
        stopwatchAccessToken = model.accessToken
    }

    private func reconnect() { save() }

    private func save() {
        guard !focus.isBusy else { return }
        if apiBaseURL != model.apiBaseURL && focus.hasAccountWork { confirmBackendChange = true } else { apply() }
    }

    private func apply() {
        // Focus credentials never touch the shared stopwatch connection or its queue.
        model.applySettings(apiBaseURL: apiBaseURL, accessToken: stopwatchAccessToken)
        Task { await sidebar.prepareFocus() }
    }
}
