import Foundation

struct FocusAuthConfiguration: Equatable, Sendable {
    let apiURL: URL
    let supabaseURL: URL
    let publishableKey: String

    var storageScope: String { "\(apiURL.absoluteString)|\(supabaseURL.absoluteString)" }

    static var bundledValues: [String: String] {
        guard let url = Bundle.main.url(forResource: "FocusAuthConfiguration", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let values = try? JSONDecoder().decode([String: String].self, from: data)
        else { return [:] }
        return values
    }

    static func resolve(
        apiBaseURL: String, environment: [String: String], bundled: [String: String],
        defaults: UserDefaults?
    ) throws -> Self {
        let api = try origin(apiBaseURL).absoluteString
        let configurationKey = "focus-auth-provider:\(api)"
        let provided =
            environment["WELLSPENT_SUPABASE_URL"] != nil
            || environment["WELLSPENT_SUPABASE_PUBLISHABLE_KEY"] != nil
        let bundledAPI = bundled["WELLSPENT_API_URL"].flatMap { try? origin($0).absoluteString }
        // Never use a different API's bundled provider, even within the same environment.
        let saved = defaults?.dictionary(forKey: configurationKey) as? [String: String] ?? [:]
        let values = provided ? environment : (bundledAPI == api ? bundled : saved)
        let result = try Self(apiBaseURL: api, environment: values)
        defaults?.set(
            [
                "WELLSPENT_API_URL": api,
                "WELLSPENT_SUPABASE_URL": result.supabaseURL.absoluteString,
                "WELLSPENT_SUPABASE_PUBLISHABLE_KEY": result.publishableKey,
            ], forKey: configurationKey)
        return result
    }

    init(apiBaseURL: String, environment: [String: String] = ProcessInfo.processInfo.environment) throws {
        guard let authURL = environment["WELLSPENT_SUPABASE_URL"],
            let key = environment["WELLSPENT_SUPABASE_PUBLISHABLE_KEY"], !key.isEmpty,
            key.range(of: #"^sb_publishable_[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil
                || Self.isAnonymousKey(key)
        else { throw FocusAuthError.configuration }
        apiURL = try Self.origin(apiBaseURL)
        if let declaredAPI = environment["WELLSPENT_API_URL"] {
            guard try Self.origin(declaredAPI) == apiURL else { throw FocusAuthError.configuration }
        }
        supabaseURL = try Self.origin(authURL)
        guard Self.isLocal(apiURL) == Self.isLocal(supabaseURL) else { throw FocusAuthError.configuration }
        publishableKey = key
    }

    private static func origin(_ value: String) throws -> URL {
        guard let components = URLComponents(string: value), let url = components.url,
            components.host != nil, components.user == nil, components.password == nil,
            components.query == nil, components.fragment == nil,
            components.path.isEmpty || components.path == "/",
            components.scheme == "https" || (components.scheme == "http" && isLocal(url))
        else { throw FocusAuthError.configuration }
        var canonical = components
        canonical.path = ""
        guard let origin = canonical.url else { throw FocusAuthError.configuration }
        return origin
    }

    static func isLocal(_ url: URL) -> Bool {
        let host = url.host() ?? ""
        let parts = host.split(separator: ".").compactMap { Int($0) }
        return host == "localhost" || host == "[::1]" || host == "::1" || host.hasSuffix(".local")
            || (parts.count == 4
                && (parts[0] == 127 || parts[0] == 10
                    || (parts[0] == 192 && parts[1] == 168)
                    || (parts[0] == 172 && (16...31).contains(parts[1]))))
    }

    private static func isAnonymousKey(_ key: String) -> Bool {
        let parts = key.split(separator: ".")
        guard parts.count == 3 else { return false }
        var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded),
            let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        return claims["role"] as? String == "anon"
    }
}
