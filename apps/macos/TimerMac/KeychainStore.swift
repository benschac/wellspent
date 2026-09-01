import Foundation
import Security

struct KeychainStore {
    private let service = "com.benjaminschachter.timer.macos"
    private let account = "realtime-bearer-token"

    func readToken() -> String {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
            let data = result as? Data,
            let token = String(data: data, encoding: .utf8)
        else {
            return ""
        }

        return token
    }

    func saveToken(_ token: String) throws {
        let identity: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]

        if token.isEmpty {
            let deleteStatus = SecItemDelete(identity as CFDictionary)
            guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound
            else {
                throw keychainError(status: deleteStatus)
            }
            return
        }

        let attributes: [CFString: Any] = [
            kSecValueData: Data(token.utf8),
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(
            identity as CFDictionary,
            attributes as CFDictionary
        )

        if updateStatus == errSecSuccess {
            return
        }

        guard updateStatus == errSecItemNotFound else {
            throw keychainError(status: updateStatus)
        }

        var item = identity
        item.merge(attributes) { _, newValue in newValue }
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw keychainError(status: addStatus)
        }
    }

    private func keychainError(status: OSStatus) -> NSError {
        let message =
            SecCopyErrorMessageString(status, nil) as String?
            ?? "The macOS Keychain returned status \(status)."

        return NSError(
            domain: NSOSStatusErrorDomain,
            code: Int(status),
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
