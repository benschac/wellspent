import Foundation
import Security

@MainActor
struct FocusAuthStorage {
    var read: (String) throws -> Data?
    var write: (String, Data?) throws -> Void

    static let keychain = FocusAuthStorage(
        read: { scope in
            var query = identity(scope)
            query[kSecReturnData] = true
            query[kSecMatchLimit] = kSecMatchLimitOne
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            if status == errSecItemNotFound { return nil }
            guard status == errSecSuccess, let data = result as? Data else { throw FocusAuthError.storage }
            return data
        },
        write: { scope, data in
            let query = identity(scope)
            guard let data else {
                let status = SecItemDelete(query as CFDictionary)
                guard status == errSecSuccess || status == errSecItemNotFound else { throw FocusAuthError.storage }
                return
            }
            let attributes: [CFString: Any] = [
                kSecValueData: data,
                kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            if status == errSecSuccess { return }
            guard status == errSecItemNotFound else { throw FocusAuthError.storage }
            var item = query
            item.merge(attributes) { _, value in value }
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw FocusAuthError.storage }
        }
    )

    private static func identity(_ scope: String) -> [CFString: Any] {
        [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: "com.benjaminschachter.timer.macos.focus-auth",
            kSecAttrAccount: scope,
            kSecAttrSynchronizable: false,
        ]
    }
}
