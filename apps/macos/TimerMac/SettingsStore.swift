import Foundation

struct SettingsStore {
    private static let apiBaseURLKey = "apiBaseURL"
    private let defaults: UserDefaults
    let launchAPIBaseURL: String?

    init(defaults: UserDefaults = .standard, environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.defaults = defaults
        launchAPIBaseURL = environment["WELLSPENT_API_URL"]
    }

    var apiBaseURL: String {
        launchAPIBaseURL ?? defaults.string(forKey: Self.apiBaseURLKey) ?? "http://localhost:3001"
    }

    func save(apiBaseURL: String) {
        guard launchAPIBaseURL == nil else { return }
        defaults.set(apiBaseURL, forKey: Self.apiBaseURLKey)
    }
}
