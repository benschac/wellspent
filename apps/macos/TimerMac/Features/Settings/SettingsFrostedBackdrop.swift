import SwiftUI

struct SettingsFrostedBackdrop: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            if reduceTransparency {
                Color(white: 0.14)
            } else {
                SettingsFrostedMaterial()
                Color.white.opacity(0.12)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
