import ActivityKit
import SwiftUI
import WidgetKit

private let timerAccent = Color(red: 0.35, green: 0.96, blue: 0.76)

private struct TimerLiveActivityTimerText: View {
  let state: TimerLiveActivityAttributes.ContentState
  var size: CGFloat = 18

  private var pausedTime: String {
    let clampedMs = max(0, Int(state.elapsedMs))
    let minutes = clampedMs / 60_000
    let seconds = (clampedMs / 1_000) % 60
    let hundredths = (clampedMs / 10) % 100
    return String(format: "%d:%02d.%02d", minutes, seconds, hundredths)
  }

  var body: some View {
    Group {
      if state.isRunning {
        Text(
          timerInterval: Date(timeIntervalSince1970: state.originEpochMs / 1_000)...Date.distantFuture,
          countsDown: false,
          showsHours: false
        )
      } else {
        Text(pausedTime)
      }
    }
    .font(.system(size: size, weight: .bold, design: .monospaced))
    .monospacedDigit()
    .foregroundStyle(timerAccent)
    .lineLimit(1)
  }
}

private struct TimerLiveActivityButton: View {
  let context: ActivityViewContext<TimerLiveActivityAttributes>

  var body: some View {
    if #available(iOS 17.0, *) {
      Button(
        intent: TimerLiveActivityControlIntent(
          activityId: context.activityID,
          action: context.state.isRunning ? .pause : .start
        )
      ) {
        Label(
          context.state.isRunning ? "Pause" : "Resume",
          systemImage: context.state.isRunning ? "pause.fill" : "play.fill"
        )
      }
      .buttonStyle(.bordered)
      .controlSize(.small)
      .tint(timerAccent)
    }
  }
}

private struct TimerLiveActivityBanner: View {
  let context: ActivityViewContext<TimerLiveActivityAttributes>

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: context.state.isRunning ? "stopwatch.fill" : "pause.circle.fill")
        .font(.system(size: 28))
        .foregroundStyle(timerAccent)
      VStack(alignment: .leading, spacing: 2) {
        Text(context.state.isRunning ? "Timer running" : "Timer paused")
          .font(.caption.weight(.semibold))
        TimerLiveActivityTimerText(state: context.state)
      }
      Spacer(minLength: 0)
      TimerLiveActivityButton(context: context)
    }
    .padding(16)
    .widgetURL(context.attributes.deepLinkUrl.flatMap(URL.init(string:)))
  }
}

@available(iOS 16.1, *)
struct TimerLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TimerLiveActivityAttributes.self) { context in
      TimerLiveActivityBanner(context: context)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: context.state.isRunning ? "stopwatch.fill" : "pause.circle.fill")
            .font(.system(size: 24))
            .foregroundStyle(timerAccent)
        }
        DynamicIslandExpandedRegion(.trailing) {
          TimerLiveActivityTimerText(state: context.state)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 12) {
            Text(context.state.isRunning ? "Counting up" : "Paused")
              .font(.caption.weight(.semibold))
              .foregroundStyle(timerAccent)
            Spacer(minLength: 0)
            TimerLiveActivityButton(context: context)
          }
          .padding(.bottom, 8)
        }
      } compactLeading: {
        Image(systemName: context.state.isRunning ? "stopwatch.fill" : "pause.fill")
          .foregroundStyle(timerAccent)
      } compactTrailing: {
        TimerLiveActivityTimerText(state: context.state, size: 14)
      } minimal: {
        Image(systemName: "stopwatch.fill")
          .foregroundStyle(timerAccent)
      }
      .widgetURL(context.attributes.deepLinkUrl.flatMap(URL.init(string:)))
    }
  }
}
