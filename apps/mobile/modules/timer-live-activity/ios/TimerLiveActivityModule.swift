import ActivityKit
import ExpoModulesCore

private let pushTokenEvent = "onPushToken"

private struct TimerLiveActivityStateRecord: Record {
  @Field var elapsedMs: Double = 0
  @Field var isRunning: Bool = false
  @Field var originEpochMs: Double = 0
  @Field var realtimeUrl: String = ""

  var contentState: TimerLiveActivityAttributes.ContentState {
    TimerLiveActivityAttributes.ContentState(
      elapsedMs: max(0, elapsedMs),
      isRunning: isRunning,
      originEpochMs: originEpochMs,
      realtimeUrl: realtimeUrl
    )
  }
}

private final class LiveActivitiesDisabledException: Exception, @unchecked Sendable {
  override var reason: String {
    "Live Activities are not available or are disabled on this device"
  }
}

public class TimerLiveActivityModule: Module {
  private var pushTokenTasks: [String: Task<Void, Never>] = [:]

  public func definition() -> ModuleDefinition {
    Name("TimerLiveActivity")
    Events(pushTokenEvent)

    OnStartObserving(pushTokenEvent) {
      for activity in Activity<TimerLiveActivityAttributes>.activities {
        self.observePushToken(for: activity)
      }
    }

    OnStopObserving(pushTokenEvent) {
      self.cancelPushTokenTasks()
    }

    AsyncFunction("startOrUpdate") {
      (state: TimerLiveActivityStateRecord, startIfMissing: Bool) async throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        if startIfMissing {
          throw LiveActivitiesDisabledException()
        }
        return nil
      }

      if let activity = Activity<TimerLiveActivityAttributes>.activities.first(where: {
        $0.activityState == .active || $0.activityState == .stale
      }) {
        observePushToken(for: activity)
        await activity.update(
          ActivityContent(state: state.contentState, staleDate: nil)
        )
        return activity.id
      }

      guard startIfMissing else {
        return nil
      }

      let activity = try Activity.request(
        attributes: TimerLiveActivityAttributes(deepLinkUrl: "timer://"),
        content: ActivityContent(state: state.contentState, staleDate: nil),
        pushType: .token
      )
      observePushToken(for: activity)
      return activity.id
    }

    AsyncFunction("end") { () async in
      for activity in Activity<TimerLiveActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      cancelPushTokenTasks()
    }
  }

  private func observePushToken(
    for activity: Activity<TimerLiveActivityAttributes>
  ) {
    guard pushTokenTasks[activity.id] == nil else {
      return
    }

    if let pushToken = activity.pushToken {
      emitPushToken(pushToken, activityId: activity.id)
    }

    pushTokenTasks[activity.id] = Task { [weak self] in
      for await pushToken in activity.pushTokenUpdates {
        guard !Task.isCancelled else {
          return
        }
        self?.emitPushToken(pushToken, activityId: activity.id)
      }
    }
  }

  private func emitPushToken(_ pushToken: Data, activityId: String) {
    sendEvent(pushTokenEvent, [
      "activityId": activityId,
      "pushToken": pushToken.map { String(format: "%02x", $0) }.joined(),
    ])
  }

  private func cancelPushTokenTasks() {
    for task in pushTokenTasks.values {
      task.cancel()
    }
    pushTokenTasks.removeAll()
  }
}
