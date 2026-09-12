import Foundation

enum TimerProjection {
    static func diagnosticEndpoint(from apiBaseURL: String) -> String {
        guard let url = webSocketURL(from: apiBaseURL),
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return "Invalid API URL" }
        components.user = nil
        components.password = nil
        components.query = nil
        components.fragment = nil
        return components.string ?? "Invalid API URL"
    }

    static func elapsedMilliseconds(
        for state: RealtimeTimerState,
        now: Date
    ) -> Double {
        guard state.isRunning,
            let updatedAt = try? Date(state.updatedAt, strategy: .iso8601)
        else {
            return state.elapsedMilliseconds
        }

        return state.elapsedMilliseconds
            + max(0, now.timeIntervalSince(updatedAt) * 1_000)
    }

    static func webSocketURL(from apiBaseURL: String) -> URL? {
        guard let baseURL = URL(string: apiBaseURL),
            var components = URLComponents(
                url: URL(string: "/api/ws", relativeTo: baseURL)?.absoluteURL
                    ?? baseURL,
                resolvingAgainstBaseURL: true
            )
        else {
            return nil
        }

        switch components.scheme {
        case "http":
            components.scheme = "ws"
        case "https":
            components.scheme = "wss"
        case "ws", "wss":
            break
        default:
            return nil
        }

        return components.url
    }
}
