import SwiftUI

struct FocusDetailView: View {
    let detail: FocusDetail
    @Environment(FocusModel.self) private var focus
    @State private var confirmReload = false

    var body: some View {
        @Bindable var focus = focus
        Form {
            Section {
                Text(detail.session.intention).font(.title2.bold()).textSelection(.enabled)
                HStack {
                    FocusElapsedView(session: detail.session)
                        .id("\(detail.session.id)-\(detail.session.revision)")
                    Spacer()
                    Text(detail.session.status.rawValue.capitalized).foregroundStyle(.secondary)
                }
                HStack {
                    if detail.session.status != .completed {
                        Button(detail.session.status == .running ? "Pause" : "Resume", action: toggle)
                            .buttonStyle(.borderedProminent)
                        Button("Finish Session", action: finish)
                    } else {
                        Label("Completed", systemImage: "checkmark.circle")
                    }
                }.disabled(!focus.canWrite)
            }
            Section("Notes") {
                TextField("Add a note about this session", text: $focus.note, axis: .vertical)
                    .lineLimit(2...5).disabled(!focus.canWrite)
                Button("Add Note", action: addNote)
                    .disabled(!focus.canWrite || !validNote)
            }
            Section("Recap") {
                TextField("Write your recap", text: $focus.recap, axis: .vertical)
                    .lineLimit(3...10).disabled(!focus.canWrite)
                if focus.hasRecapChanges && focus.recapDraftRevision != detail.session.recapRevision {
                    Text(
                        "The saved recap changed on another device. Your draft is preserved; reload to use the saved version."
                    )
                    .font(.caption).foregroundStyle(.orange)
                }
                HStack {
                    Button("Save Recap", action: saveRecap)
                        .disabled(!focus.canWrite || !focus.hasRecapChanges || focus.recap.utf16.count > 8000)
                    Button("Reload Saved Recap") { confirmReload = true }
                        .disabled(!focus.canWrite || !focus.hasRecapChanges)
                }
                if !detail.generatedRecap.isEmpty {
                    DisclosureGroup("Generated recap") {
                        Text(detail.generatedRecap).textSelection(.enabled)
                    }
                }
            }
            Section("Activity") {
                if detail.events.isEmpty { Text("No notes or captured activity yet.").foregroundStyle(.secondary) }
                ForEach(detail.events) { event in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(event.summary).textSelection(.enabled)
                        HStack {
                            Text(event.source.capitalized)
                            Text(event.occurredAt, format: .dateTime.month().day().hour().minute())
                            if let url = event.evidenceLink { Link("Evidence", destination: url) }
                        }.font(.caption).foregroundStyle(.secondary)
                    }
                }
                if detail.segmentsTruncated { Text("This session's timeline is truncated.").font(.caption) }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .confirmationDialog("Replace your draft with the saved recap?", isPresented: $confirmReload) {
            Button("Reload Saved Recap", role: .destructive, action: focus.reloadRecap)
            Button("Cancel", role: .cancel) {}
        }
    }

    private var validNote: Bool {
        (1...2000).contains(focus.note.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count)
    }
    private func toggle() { Task { await focus.transition(detail.session.status == .running ? "pause" : "resume") } }
    private func finish() { Task { await focus.transition("finish") } }
    private func addNote() { Task { await focus.addNote() } }
    private func saveRecap() { Task { await focus.saveRecap() } }
}
