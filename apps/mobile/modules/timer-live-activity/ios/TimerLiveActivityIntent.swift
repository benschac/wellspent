import ActivityKit
import AppIntents
import Foundation

enum TimerLiveActivityAction: String, AppEnum {
  case pause
  case start

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Timer action")
  static var caseDisplayRepresentations: [TimerLiveActivityAction: DisplayRepresentation] = [
    .pause: DisplayRepresentation(title: "Pause"),
    .start: DisplayRepresentation(title: "Start")
  ]
}

private struct TimerStateEnvelope: Decodable {
  let event: String
  let data: TimerServerState
}

private struct TimerServerState: Decodable {
  let elapsedMs: Double
  let isRunning: Bool
  let updatedAt: String
}

private enum TimerLiveActivityError: Error {
  case activityNotFound
  case invalidServerMessage
  case invalidURL
}

@available(iOS 17.0, *)
struct TimerLiveActivityControlIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Control timer"
  static var isDiscoverable = false

  @Parameter(title: "Activity")
  var activityId: String

  @Parameter(title: "Action")
  var action: TimerLiveActivityAction

  init() {
    activityId = ""
    action = .pause
  }

  init(activityId: String, action: TimerLiveActivityAction) {
    self.activityId = activityId
    self.action = action
  }

  func perform() async throws -> some IntentResult {
    do {
      guard let activity = Activity<TimerLiveActivityAttributes>.activities.first(where: {
        $0.id == activityId
      }) else {
        throw TimerLiveActivityError.activityNotFound
      }
      guard let realtimeURL = URL(string: activity.content.state.realtimeUrl) else {
        throw TimerLiveActivityError.invalidURL
      }

      let serverState = try await Self.send(action: action, to: realtimeURL)
      let nowMs = Date().timeIntervalSince1970 * 1_000
      let serverUpdatedAt = Self.parseServerDate(serverState.updatedAt)
      let elapsedSinceUpdate = serverState.isRunning
        ? max(0, nowMs - (serverUpdatedAt?.timeIntervalSince1970 ?? Date().timeIntervalSince1970) * 1_000)
        : 0
      let elapsedMs = max(0, serverState.elapsedMs + elapsedSinceUpdate)
      let nextState = TimerLiveActivityAttributes.ContentState(
        elapsedMs: elapsedMs,
        isRunning: serverState.isRunning,
        originEpochMs: nowMs - elapsedMs,
        realtimeUrl: realtimeURL.absoluteString
      )

      await activity.update(ActivityContent(state: nextState, staleDate: nil))
    } catch {
      // App intents should complete without surfacing an opaque system error to the user.
      print("[TimerLiveActivity] Control action failed: \(error)")
    }

    return .result()
  }

  private static func send(
    action: TimerLiveActivityAction,
    to realtimeURL: URL
  ) async throws -> TimerServerState {
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

    _ = try await receiveTimerState(from: socket)
    let command = #"{"event":"timer.command","data":{"action":"\#(action.rawValue)"}}"#
    try await socket.send(.string(command))
    return try await receiveTimerState(from: socket)
  }

  private static func receiveTimerState(
    from socket: URLSessionWebSocketTask
  ) async throws -> TimerServerState {
    while true {
      let message = try await socket.receive()
      let data: Data

      switch message {
      case .data(let value):
        data = value
      case .string(let value):
        guard let valueData = value.data(using: .utf8) else {
          throw TimerLiveActivityError.invalidServerMessage
        }
        data = valueData
      @unknown default:
        throw TimerLiveActivityError.invalidServerMessage
      }

      let envelope = try JSONDecoder().decode(TimerStateEnvelope.self, from: data)
      if envelope.event == "timer.state" {
        return envelope.data
      }
    }
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
