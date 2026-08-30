import AppIntents
import Foundation
import SwiftUI
import WidgetKit
internal import ExpoWidgets

private let timerWidgetKind = "TimerWidget"
private let timerWidgetTimelineKey = "__expo_widgets_TimerWidget_timeline"

private enum TimerWidgetAction: String, AppEnum {
  case pause
  case start

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Timer action")
  static var caseDisplayRepresentations: [TimerWidgetAction: DisplayRepresentation] = [
    .pause: DisplayRepresentation(title: "Pause"),
    .start: DisplayRepresentation(title: "Start")
  ]
}

private struct TimerStateEnvelope: Decodable {
  let event: String
  let data: TimerState
}

private struct TimerState: Decodable {
  let elapsedMs: Double
  let isRunning: Bool
  let updatedAt: String
}

private enum TimerWidgetActionError: Error {
  case missingRealtimeURL
  case invalidServerMessage
}

private extension View {
  @ViewBuilder
  func timerWidgetBackground() -> some View {
    let color = Color(red: 0.02, green: 0.07, blue: 0.11)

    if #available(iOS 17.0, *) {
      containerBackground(color, for: .widget)
    } else {
      background(color)
    }
  }
}

@available(iOS 17.0, *)
private struct TimerWidgetControlIntent: AppIntent {
  static var title: LocalizedStringResource = "Control timer"
  static var isDiscoverable = false

  @Parameter(title: "Action")
  var action: TimerWidgetAction

  init() {
    action = .pause
  }

  init(action: TimerWidgetAction) {
    self.action = action
  }

  func perform() async throws -> some IntentResult {
    guard let realtimeURL = Self.readRealtimeURL() else {
      throw TimerWidgetActionError.missingRealtimeURL
    }

    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 5
    configuration.timeoutIntervalForResource = 8

    let session = URLSession(configuration: configuration)
    let socket = session.webSocketTask(with: realtimeURL)
    socket.resume()

    defer {
      socket.cancel(with: .normalClosure, reason: nil)
      session.invalidateAndCancel()
    }

    _ = try await Self.receiveTimerState(from: socket)
    let command = #"{"event":"timer.command","data":{"action":"\#(action.rawValue)"}}"#
    try await socket.send(.string(command))
    let nextState = try await Self.receiveTimerState(from: socket)

    Self.storeSnapshot(nextState, realtimeURL: realtimeURL)
    WidgetCenter.shared.reloadTimelines(ofKind: timerWidgetKind)

    return .result()
  }

  private static func readRealtimeURL() -> URL? {
    guard let timeline = WidgetsStorage.getArray(forKey: timerWidgetTimelineKey) else {
      return nil
    }

    for case let entry as [String: Any] in timeline.reversed() {
      guard let props = entry["props"] as? [String: Any],
            let value = props["realtimeUrl"] as? String,
            let url = URL(string: value) else {
        continue
      }
      return url
    }

    return nil
  }

  private static func receiveTimerState(
    from socket: URLSessionWebSocketTask
  ) async throws -> TimerState {
    while true {
      let message = try await socket.receive()
      let data: Data

      switch message {
      case .data(let value):
        data = value
      case .string(let value):
        guard let valueData = value.data(using: .utf8) else {
          throw TimerWidgetActionError.invalidServerMessage
        }
        data = valueData
      @unknown default:
        throw TimerWidgetActionError.invalidServerMessage
      }

      let envelope = try JSONDecoder().decode(TimerStateEnvelope.self, from: data)
      if envelope.event == "timer.state" {
        return envelope.data
      }
    }
  }

  private static func storeSnapshot(_ state: TimerState, realtimeURL: URL) {
    guard let groupIdentifier = WidgetsStorage.appGroupIdentifier,
          let defaults = UserDefaults(suiteName: groupIdentifier) else {
      return
    }

    let nowMs = Date().timeIntervalSince1970 * 1_000
    let updatedAt = parseServerDate(state.updatedAt)
    let elapsedSinceUpdate = state.isRunning
      ? max(0, nowMs - (updatedAt?.timeIntervalSince1970 ?? Date().timeIntervalSince1970) * 1_000)
      : 0
    let elapsedMs = state.elapsedMs + elapsedSinceUpdate
    let props: [String: Any] = [
      "elapsedMs": elapsedMs,
      "isRunning": state.isRunning,
      "originEpochMs": nowMs - elapsedMs,
      "realtimeUrl": realtimeURL.absoluteString
    ]
    let entry: [String: Any] = [
      "timestamp": Int(nowMs),
      "props": props
    ]

    defaults.set([entry], forKey: timerWidgetTimelineKey)
  }

  private static func parseServerDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) {
      return date
    }

    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
  }
}

private struct TimerWidgetEntryView: View {
  let entry: WidgetsTimelineEntry

  private var elapsedMs: Double {
    (entry.props?["elapsedMs"] as? NSNumber)?.doubleValue ?? 0
  }

  private var isRunning: Bool {
    (entry.props?["isRunning"] as? NSNumber)?.boolValue ?? false
  }

  private var originDate: Date {
    let originEpochMs = (entry.props?["originEpochMs"] as? NSNumber)?.doubleValue ?? 0
    return Date(timeIntervalSince1970: originEpochMs / 1_000)
  }

  private var pausedTime: String {
    let clampedMs = max(0, Int(elapsedMs))
    let minutes = clampedMs / 60_000
    let seconds = (clampedMs / 1_000) % 60
    let hundredths = (clampedMs / 10) % 100
    return String(format: "%d:%02d.%02d", minutes, seconds, hundredths)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 7) {
        Image(systemName: "timer")
          .foregroundStyle(Color(red: 0.35, green: 0.96, blue: 0.76))
        Text("SHARED TIMER")
          .font(.caption2.weight(.bold))
          .foregroundStyle(Color(red: 0.55, green: 0.64, blue: 0.71))
      }

      Text(isRunning ? "Running" : "Paused")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.white.opacity(0.82))

      Group {
        if isRunning {
          Text(
            timerInterval: originDate...Date.distantFuture,
            countsDown: false,
            showsHours: false
          )
        } else {
          Text(pausedTime)
        }
      }
      .font(.system(size: 31, weight: .bold, design: .rounded))
      .monospacedDigit()
      .foregroundStyle(Color(red: 0.35, green: 0.96, blue: 0.76))
      .minimumScaleFactor(0.68)
      .lineLimit(1)

      Spacer(minLength: 0)

      if #available(iOS 17.0, *) {
        Button(intent: TimerWidgetControlIntent(action: isRunning ? .pause : .start)) {
          Label(isRunning ? "Pause" : "Resume", systemImage: isRunning ? "pause.fill" : "play.fill")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
        .tint(Color(red: 0.07, green: 0.42, blue: 0.37))
      }
    }
    .padding(14)
    .timerWidgetBackground()
  }
}

struct TimerWidget: Widget {
  let name = timerWidgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: name, provider: WidgetsTimelineProvider(name: name)) { entry in
      TimerWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Timer")
    .description("See and control the shared timer.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
