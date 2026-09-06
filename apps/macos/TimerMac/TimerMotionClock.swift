import AppKit
import QuartzCore

/// One refresh-synchronized clock owns both dragging and release settling.
@MainActor
final class TimerMotionClock: NSObject {
    private var link: CADisplayLink?
    var tick: ((CFTimeInterval) -> Void)?

    func start(in view: NSView) {
        guard link == nil else { return }
        let link = view.displayLink(target: self, selector: #selector(step(_:)))
        self.link = link
        link.add(to: .main, forMode: .common)
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    @objc private func step(_ link: CADisplayLink) { tick?(link.targetTimestamp) }

    static func settlingProgress(at elapsed: Double) -> CGFloat {
        // Critically damped spring: fast catch, gentle arrival, no screen-edge overshoot.
        let t = max(0, elapsed) * 22
        return 1 - (1 + t) * exp(-t)
    }
}
