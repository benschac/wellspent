import Foundation
import Testing

@testable import TimerMac

struct FocusAuthConfigurationTests {
    private let bundled = [
        "WELLSPENT_API_URL": "https://api.example.test",
        "WELLSPENT_SUPABASE_URL": "https://auth.example.test",
        "WELLSPENT_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_bundled",
    ]

    @Test
    func bundledConfigurationBootstrapsAndRestoresWithoutLaunchEnvironment() throws {
        let suite = "configuration-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = try FocusAuthConfiguration.resolve(
            apiBaseURL: "https://api.example.test/", environment: [:], bundled: bundled, defaults: defaults)
        let restarted = try FocusAuthConfiguration.resolve(
            apiBaseURL: "https://api.example.test", environment: [:], bundled: [:], defaults: defaults)
        #expect(first == restarted)
        #expect(first.publishableKey == "sb_publishable_bundled")
        for api in ["http://localhost:3001", "https://other-api.example.test"] {
            #expect(throws: FocusAuthError.self) {
                try FocusAuthConfiguration.resolve(
                    apiBaseURL: api, environment: [:], bundled: bundled, defaults: defaults)
            }
        }
    }

    @Test
    func explicitConfigurationWinsAndInvalidOverridesNeverFallBack() throws {
        var launch = bundled
        launch["WELLSPENT_SUPABASE_PUBLISHABLE_KEY"] = "sb_publishable_launch"
        let resolved = try FocusAuthConfiguration.resolve(
            apiBaseURL: "https://api.example.test", environment: launch, bundled: bundled, defaults: nil)
        #expect(resolved.publishableKey == "sb_publishable_launch")
        for invalid in [
            ["WELLSPENT_SUPABASE_URL": ""],
            ["WELLSPENT_SUPABASE_PUBLISHABLE_KEY": "sb_secret_invalid"],
            launch.merging(["WELLSPENT_API_URL": "https://different.example.test"]) { _, new in new },
        ] {
            #expect(throws: FocusAuthError.self) {
                try FocusAuthConfiguration.resolve(
                    apiBaseURL: "https://api.example.test", environment: invalid, bundled: bundled, defaults: nil)
            }
        }
    }

    @Test
    func missingAndMalformedSourcesFailClosed() {
        for values in [
            [:], bundled.merging(["WELLSPENT_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_"]) { _, new in new },
        ] {
            #expect(throws: FocusAuthError.self) {
                try FocusAuthConfiguration.resolve(
                    apiBaseURL: "https://api.example.test", environment: [:], bundled: values, defaults: nil)
            }
        }
    }

    @Test
    func backendOriginsAndKeysAreValidatedAndStorageIsIsolated() throws {
        let production = try configuration()
        let local = try FocusAuthConfiguration(
            apiBaseURL: "http://localhost:3001",
            environment: [
                "WELLSPENT_SUPABASE_URL": "http://127.0.0.1:54421",
                "WELLSPENT_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_local",
            ])
        #expect(local.storageScope != production.storageScope)
        for api in [
            "http://api.example.test", "https://secret@api.example.test", "https://api.example.test?x=y",
            "http://localhost:3001", "https://api.example.test/path",
        ] {
            #expect(throws: FocusAuthError.self) { try configuration(api: api) }
        }
        #expect(throws: FocusAuthError.self) { try configuration(key: "sb_secret_forbidden") }
        let secretJWT = "e30." + Data(#"{"role":"service_role"}"#.utf8).base64EncodedString() + ".signature"
        #expect(throws: FocusAuthError.self) { try configuration(key: secretJWT) }
    }

    private func configuration(api: String = "https://api.example.test", key: String = "sb_publishable_fixture") throws
        -> FocusAuthConfiguration
    {
        try FocusAuthConfiguration(
            apiBaseURL: api,
            environment: [
                "WELLSPENT_SUPABASE_URL": "https://auth.example.test",
                "WELLSPENT_SUPABASE_PUBLISHABLE_KEY": key,
            ])
    }
}
