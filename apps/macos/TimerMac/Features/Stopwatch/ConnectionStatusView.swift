import SwiftUI

struct ConnectionStatusView: View {
    let state: ConnectionState

    var body: some View {
        Label(state.label, systemImage: state.symbolName)
            .font(.subheadline)
            .foregroundStyle(state == .connected ? .green : .secondary)
            .accessibilityLabel("Timer sync status: \(state.label)")
    }
}
