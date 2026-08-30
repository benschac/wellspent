import ActivityKit

struct TimerLiveActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    let elapsedMs: Double
    let isRunning: Bool
    let originEpochMs: Double
    let realtimeUrl: String
  }

  let deepLinkUrl: String?
}
