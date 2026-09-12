import AppKit
import SwiftUI

/// AppKit supplies real desktop blur; the mask follows the same body geometry
/// used by the tint and rim, including the liquid neck toward the screen edge.
final class TimerFrostedView: NSVisualEffectView {
    private var maskSize = CGSize.zero
    private var maskPath: CGPath?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        material = .hudWindow
        blendingMode = .behindWindow
        state = .active
        appearance = NSAppearance(named: .darkAqua)
    }

    required init?(coder: NSCoder) { nil }

    func updateMask(size: CGSize, path: CGPath) {
        guard size != maskSize || maskPath != path else { return }
        maskSize = size
        maskPath = path
        maskImage = NSImage(size: size, flipped: true) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            context.setFillColor(NSColor.white.cgColor)
            context.addPath(path)
            context.fillPath()
            return true
        }
    }
}
