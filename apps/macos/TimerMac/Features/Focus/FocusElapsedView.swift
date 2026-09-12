import SwiftUI

struct FocusElapsedView: View {
    let session: FocusSession
    @State private var anchorDate = Date.now
    @State private var anchorUptime = ProcessInfo.processInfo.systemUptime

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let elapsed =
                session.elapsedMilliseconds(at: anchorDate)
                + (session.status == .running ? max(0, ProcessInfo.processInfo.systemUptime - anchorUptime) * 1_000 : 0)
            Text(TimerFormatting.clock(milliseconds: elapsed))
                .font(.largeTitle.monospacedDigit())
                .accessibilityLabel(TimerFormatting.accessibilityLabel(milliseconds: elapsed))
        }
    }
}
