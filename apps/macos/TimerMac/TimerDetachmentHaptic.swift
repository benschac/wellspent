import Foundation
import LiquidUI

/// One detachment tick per pickup. Hovering around the separation boundary or
/// pulling back and forth cannot repeatedly fire the trackpad.
struct TimerDetachmentHaptic {
    private var isArmed = false

    mutating func begin(attached: Bool, gap: CGFloat) {
        isArmed = attached && gap < TimerLiquidShape.separationDistance
    }

    mutating func update(gap: CGFloat) -> Bool {
        guard isArmed, gap >= TimerLiquidShape.separationDistance else { return false }
        isArmed = false
        return true
    }
}
