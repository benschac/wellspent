import Foundation

struct SettingsStore {
    private static let apiBaseURLKey = "apiBaseURL"
    private static let durationMinutesKey = "durationMinutes"

    private let defaults = UserDefaults.standard

    var apiBaseURL: String {
        defaults.string(forKey: Self.apiBaseURLKey) ?? "http://localhost:3001"
    }

    var durationMinutes: Int {
        let storedValue = defaults.integer(forKey: Self.durationMinutesKey)
        return storedValue > 0 ? storedValue : 25
    }

    func save(apiBaseURL: String, durationMinutes: Int) {
        defaults.set(apiBaseURL, forKey: Self.apiBaseURLKey)
        defaults.set(durationMinutes, forKey: Self.durationMinutesKey)
    }
}
