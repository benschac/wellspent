import SwiftUI

struct FocusWindowView: View {
    @Environment(FocusAuthModel.self) private var auth
    @Environment(TimerSidebarController.self) private var sidebar
    @Environment(FocusModel.self) private var focus
    @State private var proposedSelection: UUID?
    @State private var confirmSelection = false
    @State private var confirmCreate = false

    @State private var showingDetail = false
    @FocusState private var intentionFocused: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        @Bindable var focus = focus
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "scope")
                    .font(.title2).foregroundStyle(.secondary).accessibilityHidden(true)
                TextField("What do you want to focus on?", text: $focus.intention)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($intentionFocused)
                    .onSubmit(create)
                    .disabled(focus.isBusy || focus.pendingMutation != nil)
                if focus.isBusy { ProgressView().controlSize(.small) }
                Button("Start Focus", systemImage: "return", action: create)
                    .labelStyle(.iconOnly)
                    .help("Start Focus (Return)")
                    .disabled(!focus.canWrite || !validIntention)
            }
            .padding(.horizontal, 20).padding(.vertical, 22)
            Divider()
            FocusPanelNotices()
            if showingDetail, let detail = focus.detail {
                HStack {
                    Button("Recent sessions", systemImage: "chevron.left") { showingDetail = false }
                        .buttonStyle(.plain)
                    Spacer()
                }
                .font(.callout).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.top, 14)
                FocusDetailView(detail: detail)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        Text("Recent sessions")
                            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            .padding(.horizontal, 10).padding(.vertical, 8)
                        if focus.sessions.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(auth.needsSignIn ? "A little space to focus" : "Your next intention starts here")
                                    .font(.headline)
                                Text(
                                    auth.needsSignIn
                                        ? "Write an intention above. Sign in to save it and see your sessions."
                                        : "Write an intention above and press Return to begin."
                                )
                                .foregroundStyle(.secondary)
                                if auth.needsSignIn || auth.isSigningIn || auth.isRestoring {
                                    FocusSignInView().padding(.top, 6)
                                }

                            }
                            .padding(12)
                        }
                        ForEach(focus.sessions) { session in
                            Button {
                                select(session.id)
                            } label: {
                                FocusSessionRow(session: session, isSelected: focus.selectedID == session.id)
                            }
                            .buttonStyle(.plain)
                            .disabled(focus.isBusy || focus.pendingMutation != nil)
                            .accessibilityAddTraits(focus.selectedID == session.id ? [.isSelected] : [])
                        }
                    }
                    .padding(10)
                }
                .frame(maxHeight: .infinity)
            }
            Divider()
            HStack(spacing: 12) {
                Label("Focus", systemImage: "scope").fontWeight(.medium)
                Text("⌃⌥⌘F").foregroundStyle(.tertiary)
                Spacer()
                if let date = focus.lastRefreshed {
                    Text("Updated \(date, format: .dateTime.hour().minute())")
                        .foregroundStyle(.secondary)
                }
                Button("Refresh", systemImage: "arrow.clockwise", action: refresh)
                    .labelStyle(.iconOnly).help("Refresh sessions (⌘R)")
                    .keyboardShortcut("r").disabled(focus.isBusy || !auth.canAccess)
                Divider().frame(height: 14)
                Button("Settings…", systemImage: "gearshape", action: sidebar.showSettings)
                    .help("Open Settings")
                Button("Close Focus", systemImage: "xmark", action: close)
                    .labelStyle(.iconOnly).help("Close Focus (⌘W)")
                    .keyboardShortcut("w")
            }
            .buttonStyle(.plain)
            .font(.caption).foregroundStyle(.secondary)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(.primary.opacity(0.035))
        }
        .frame(minWidth: 560, minHeight: 400)
        .background {
            if reduceTransparency {
                Color(nsColor: .windowBackgroundColor)
            } else {
                FocusPanelBackdrop()
                    .overlay {
                        // Lift the desktop blur to the pale launcher surface in light mode.
                        if colorScheme == .light {
                            Color.white.opacity(0.48)
                        }
                    }
            }
        }
        .clipShape(.rect(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18).strokeBorder(.primary.opacity(0.12), lineWidth: 1)
                .allowsHitTesting(false)
        }
        .onAppear { intentionFocused = true }
        .task(id: auth.canAccess) {
            if auth.canAccess { await focus.refresh() }
        }
        .confirmationDialog("Discard your unsaved note and recap edits?", isPresented: $confirmSelection) {
            Button("Discard Edits", role: .destructive, action: confirmSwitch)
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Discard your unsaved note and recap edits and start a new session?", isPresented: $confirmCreate
        ) {
            Button("Start New Session", role: .destructive, action: startNew)
            Button("Cancel", role: .cancel) {}
        }
    }

    private var validIntention: Bool {
        (1...500).contains(focus.intention.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count)
    }
    private var hasDraft: Bool { focus.hasRecapChanges || !focus.note.isEmpty }
    private func refresh() { Task { await focus.refresh() } }
    private func close() { NSApplication.shared.keyWindow?.performClose(nil) }
    private func create() {
        guard validIntention, focus.canWrite else { return }
        if hasDraft { confirmCreate = true } else { startNew() }
    }
    private func startNew() {
        Task {
            await focus.create()
            if focus.detail != nil && focus.errorMessage == nil { showingDetail = true }
        }
    }
    private func select(_ id: UUID) {
        guard id != focus.selectedID else {
            showingDetail = true
            return
        }
        proposedSelection = id
        if hasDraft { confirmSelection = true } else { confirmSwitch() }
    }
    private func confirmSwitch() {
        guard let id = proposedSelection else { return }
        Task {
            await focus.select(id)
            if focus.selectedID == id { showingDetail = true }
        }
    }
}
