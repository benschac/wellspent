import Foundation

struct SettingsStore {
    private static let apiBaseURLKey = "apiBaseURL"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var apiBaseURL: String {
        defaults.string(forKey: Self.apiBaseURLKey) ?? "http://localhost:3001"
    }

    func save(apiBaseURL: String) {
        defaults.set(apiBaseURL, forKey: Self.apiBaseURLKey)
    }
}
