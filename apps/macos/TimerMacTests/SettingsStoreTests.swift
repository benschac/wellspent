import Foundation
import Testing

@testable import TimerMac

struct SettingsStoreTests {
    @Test
    func ordinaryLaunchUsesBundledAPIWithoutOverwritingSavedChoice() throws {
        let suite = "profile-tests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let bundle = ["WELLSPENT_API_URL": "https://api.example.test"]
        defaults.set("http://localhost:3001", forKey: "apiBaseURL")
        let store = SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: bundle)
        #expect(store.apiBaseURL == "https://api.example.test")
        #expect(store.launchAPIBaseURL == "https://api.example.test")
        store.save(apiBaseURL: "http://localhost:3001")
        let restarted = SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: bundle)
        #expect(restarted.apiBaseURL == "https://api.example.test")
        #expect(
            SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: [:]).apiBaseURL
                == "http://localhost:3001")
    }

    @MainActor
    @Test
    func aLaunchProfileCannotBeChangedThroughSettings() throws {
        let suite = "profile-tests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        // Invalid network scheme keeps this model test fully offline.
        let store = SettingsStore(defaults: defaults, environment: ["WELLSPENT_API_URL": "file:///profile-test"])
        let model = TimerModel(settingsStore: store)
        model.applySettings(apiBaseURL: "http://localhost:3001", accessToken: "")
        #expect(model.isLaunchProfile)
        #expect(model.apiBaseURL == "file:///profile-test")
        #expect(model.errorMessage?.contains("launch profile owns") == true)
    }

    @Test
    func launchProfileOverridesWithoutReplacingSavedPreferences() throws {
        let suite = "profile-tests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("http://localhost:3001", forKey: "apiBaseURL")
        let launch = SettingsStore(defaults: defaults, environment: ["WELLSPENT_API_URL": "https://api.wellspent.day"])
        #expect(launch.apiBaseURL == "https://api.wellspent.day")
        launch.save(apiBaseURL: "https://api.wellspent.day")
        #expect(
            SettingsStore(defaults: defaults, environment: [:], bundledConfiguration: [:]).apiBaseURL
                == "http://localhost:3001")
    }

    @Test
    func profileTokensNeverShareTheLegacyOrOtherEnvironmentKeychainAccount() {
        let local = KeychainStore(scope: "http://localhost:3001")
        let production = KeychainStore(scope: "https://api.wellspent.day")
        #expect(local.account != production.account)
        #expect(local.account != KeychainStore().account)
        #expect(production.account != KeychainStore().account)
    }
}
