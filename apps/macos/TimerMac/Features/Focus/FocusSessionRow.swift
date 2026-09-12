import SwiftUI

struct FocusSessionRow: View {
    let session: FocusSession
    let isSelected: Bool
    @State private var isHovered = false

    private var symbol: String {
        switch session.status {
        case .running: "play.circle.fill"
        case .paused: "pause.circle"
        case .completed: "checkmark.circle"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.title3).foregroundStyle(.secondary).accessibilityHidden(true)
            Text(session.intention).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(session.createdAt, format: .dateTime.month(.abbreviated).day())
                .foregroundStyle(.tertiary)
            Text(session.status.rawValue.capitalized)
                .foregroundStyle(.secondary).frame(width: 76, alignment: .trailing)
        }
        .font(.callout)
        .padding(.horizontal, 12).padding(.vertical, 12)
        .background(.primary.opacity(isSelected ? 0.10 : (isHovered ? 0.05 : 0)))
        .clipShape(.rect(cornerRadius: 10))
        .contentShape(.rect)
        .onHover { isHovered = $0 }
    }
}
