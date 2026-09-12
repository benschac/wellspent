import Carbon
import Foundation

/// Registers Control–Option–Command–F without requiring Accessibility permission.
@MainActor
final class FocusGlobalShortcut {
    static let displayName = "⌃⌥⌘F"

    enum RegistrationError: LocalizedError {
        case eventHandler(OSStatus)
        case hotKey(OSStatus)

        var errorDescription: String? {
            switch self {
            case .eventHandler(let status):
                return "Could not install the Focus shortcut handler (\(status))."
            case .hotKey(let status):
                return
                    "Could not register ⌃⌥⌘F (\(status)). Another app or system shortcut may already use it. You can still open Focus from Timer’s menu."
            }
        }
    }

    private static let identifier = EventHotKeyID(signature: 0x5446_4F43, id: 1)  // TFOC
    private let action: @MainActor () -> Void
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?

    init(action: @escaping @MainActor () -> Void) {
        self.action = action
    }

    isolated deinit {
        unregister()
    }

    func register() throws {
        guard hotKey == nil else { return }

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)
        )
        let handlerStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, context in
                guard let event, let context else { return OSStatus(eventNotHandledErr) }
                var identifier = EventHotKeyID()
                let status = GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                    nil, MemoryLayout<EventHotKeyID>.size, nil, &identifier
                )
                guard status == noErr else { return status }
                // Application event-target handlers run synchronously on the main event loop.
                return MainActor.assumeIsolated {
                    guard identifier.signature == FocusGlobalShortcut.identifier.signature,
                        identifier.id == FocusGlobalShortcut.identifier.id
                    else { return OSStatus(eventNotHandledErr) }
                    let shortcut = Unmanaged<FocusGlobalShortcut>.fromOpaque(context).takeUnretainedValue()
                    shortcut.action()
                    return noErr
                }
            },
            1, &eventType, Unmanaged.passUnretained(self).toOpaque(), &handler
        )
        guard handlerStatus == noErr else {
            unregister()
            throw RegistrationError.eventHandler(handlerStatus)
        }

        let registrationStatus = RegisterEventHotKey(
            UInt32(kVK_ANSI_F), UInt32(controlKey | optionKey | cmdKey), Self.identifier,
            GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &hotKey
        )
        guard registrationStatus == noErr else {
            unregister()
            throw RegistrationError.hotKey(registrationStatus)
        }
    }

    func unregister() {
        if let hotKey {
            UnregisterEventHotKey(hotKey)
            self.hotKey = nil
        }
        if let handler {
            RemoveEventHandler(handler)
            self.handler = nil
        }
    }
}
