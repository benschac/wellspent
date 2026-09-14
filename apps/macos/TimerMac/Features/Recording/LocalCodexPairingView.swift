import SwiftUI

struct LocalCodexPairingView: View {
    @Environment(RecordingModel.self) private var recording
    @State private var expanded = false

    var body: some View {
        @Bindable var intake = recording.codex
        DisclosureGroup("Local Codex activity", isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) {
                Text(intake.status).font(.caption).textSelection(.enabled)
                    .accessibilityIdentifier("local-codex-status")
                Text(
                    "Pair one known Codex thread to the active interval. Resume requires a new pairing. Reports appear after Pause or Finish; interrupted coverage is excluded."
                )
                .font(.caption).foregroundStyle(.secondary)
                HStack {
                    TextField("Helper sender ID", text: $intake.senderID)
                    TextField("Codex thread ID", text: $intake.threadID)
                    TextField("Port", value: $intake.port, format: .number.grouping(.never))
                        .frame(width: 80)
                    Button("Create pairing", action: intake.pair).disabled(!intake.canPair)
                }
                ForEach(
                    intake.grants.filter { $0.binding.localScopeID == recording.localScopeID }, id: \.binding.bindingID
                ) { grant in
                    HStack {
                        VStack(alignment: .leading) {
                            Text("Thread: \(grant.binding.threadID)")
                            Text(
                                "Recording \(grant.binding.recordingID.uuidString.prefix(8)) · interval \(grant.binding.intervalID.uuidString.prefix(8)) · \(grant.revoked ? "Revoked" : "Paired")"
                            )
                            .foregroundStyle(.secondary)
                        }
                        .font(.caption).textSelection(.enabled)
                        Spacer()
                        if !grant.revoked {
                            Button("Revoke pairing") { intake.revoke(grant.binding.bindingID) }
                                .disabled(!recording.canAct)
                        }
                    }
                }
                if let bundle = intake.pairingBundle {
                    Text(
                        "Private pairing bundle — paste only into the local helper's setup stdin. It grants access to this interval. Do not put it in chat, command arguments, or repository files."
                    )
                    .font(.caption)
                    ScrollView {
                        Text(bundle).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    }
                    .frame(maxHeight: 70)
                    Button("Hide bundle", action: intake.dismissBundle)
                }
                Text(
                    "Only allowlisted IDs, tool names, reported results, and receipt times stay on this Mac. No prompts, tool arguments/results, transcripts, or uploads. Creating a pairing does not install hooks."
                )
                .font(.caption).foregroundStyle(.secondary)
            }
            .padding(.top, 6)
        }
    }
}
