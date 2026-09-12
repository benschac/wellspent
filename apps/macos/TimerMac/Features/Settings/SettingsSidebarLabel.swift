import SwiftUI

struct SettingsSidebarLabel: View {
    let category: SettingsCategory

    var body: some View {
        Label {
            Text(category.rawValue)
        } icon: {
            Image(systemName: category.symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(category.color.gradient, in: RoundedRectangle(cornerRadius: 7))
                .accessibilityHidden(true)
        }
        .padding(.vertical, 5)
    }
}
