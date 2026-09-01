enum TimerFormatting {
    static func clock(milliseconds: Double) -> String {
        let totalSeconds = max(0, Int(milliseconds / 1_000))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60

        return "\(twoDigits(minutes)):\(twoDigits(seconds))"
    }

    static func accessibilityLabel(
        milliseconds: Double,
        isComplete: Bool = false
    ) -> String {
        guard !isComplete else {
            return "Time complete"
        }

        let totalSeconds = max(0, Int(milliseconds / 1_000))
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        let minuteUnit = minutes == 1 ? "minute" : "minutes"
        let secondUnit = seconds == 1 ? "second" : "seconds"

        return "\(minutes) \(minuteUnit), \(seconds) \(secondUnit) remaining"
    }

    private static func twoDigits(_ value: Int) -> String {
        value < 10 ? "0\(value)" : "\(value)"
    }
}
