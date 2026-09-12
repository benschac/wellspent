import SwiftUI

struct ErrorBannerView: View {
    @Environment(TimerModel.self) private var model
    let message: String

    var body: some View {
        HStack(alignment: .top) {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()

            Button("Dismiss", systemImage: "xmark", action: model.dismissError)
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
        }
        .font(.subheadline)
        .padding()
        .background(.orange.opacity(0.12))
        .clipShape(.rect(cornerRadius: 8))
    }
}
