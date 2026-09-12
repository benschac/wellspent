import SwiftUI

/// The settings window needs the widget's material, but no contour mask.
/// AppKit keeps the unmasked material filled as the split view animates.
struct SettingsFrostedMaterial: NSViewRepresentable {
    func makeNSView(context: Context) -> TimerFrostedView {
        TimerFrostedView()
    }

    func updateNSView(_ view: TimerFrostedView, context: Context) {}
}
