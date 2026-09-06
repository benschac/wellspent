import Foundation

public enum TimerLiquidMotion {
    /// Critically damped settling shared by native hosts; no edge overshoot.
    public static func settlingProgress(at elapsed: Double) -> CGFloat {
        let t = max(0, elapsed) * 22
        return 1 - (1 + t) * exp(-t)
    }
}
