import Foundation

struct SettingsStore {
    private static let apiBaseURLKey = "apiBaseURL"
    private let defaults: UserDefaults
    let launchAPIBaseURL: String?

    init(
        defaults: UserDefaults = .standard, environment: [String: String] = ProcessInfo.processInfo.environment,
        bundledConfiguration: [String: String] = FocusAuthConfiguration.bundledValues
    ) {
        self.defaults = defaults
        // A built profile owns both API selection and the existing profile-scoped stopwatch credentials.
        // Like a shell launch, it must not overwrite the user's unprofiled API preference.
        launchAPIBaseURL = environment["WELLSPENT_API_URL"] ?? bundledConfiguration["WELLSPENT_API_URL"]
    }

    var apiBaseURL: String {
        launchAPIBaseURL ?? defaults.string(forKey: Self.apiBaseURLKey) ?? "http://localhost:3001"
    }

    func save(apiBaseURL: String) {
        guard launchAPIBaseURL == nil else { return }
        defaults.set(apiBaseURL, forKey: Self.apiBaseURLKey)
    }
}
