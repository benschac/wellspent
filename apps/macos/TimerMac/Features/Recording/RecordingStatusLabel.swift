import SwiftUI

struct RecordingStatusLabel: View {
    let status: RecordingSnapshot.Status

    private var symbol: String {
        switch status {
        case .recording: "record.circle.fill"
        case .paused: "pause.circle.fill"
        case .suspended, .interrupted: "exclamationmark.circle.fill"
        case .finished: "checkmark.circle.fill"
        }
    }

    private var color: Color {
        switch status {
        case .recording: .green
        case .paused: .secondary
        case .suspended, .interrupted: .orange
        case .finished: .secondary
        }
    }

    var body: some View {
        Label(status.rawValue.capitalized, systemImage: symbol)
            .font(.body)
            .foregroundStyle(color)
    }
}
