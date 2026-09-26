import SwiftUI

struct SettingsFrostedBackdrop: View {
    var body: some View {
        // Reading surfaces need stable contrast regardless of the windows behind them.
        Color(nsColor: .windowBackgroundColor)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
