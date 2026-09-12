import Foundation

/// Separates wall-clock reconciliation from monotonic elapsed-time projection.
struct TimerClock: Sendable {
    let now: @Sendable () -> Date
    let systemUptime: @Sendable () -> TimeInterval

    static let live = TimerClock(
        now: { .now },
        systemUptime: { ProcessInfo.processInfo.systemUptime }
    )
}
