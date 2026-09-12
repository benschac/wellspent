import Foundation

enum RecordingError: Error, LocalizedError, Equatable {
    case invalidEvent, invalidTransition, conflictingIdentity, staleInterval, anotherRecording
    case unsupportedSchema, invalidStore, closed
    case storage(Int32)

    var errorDescription: String? {
        switch self {
        case .invalidEvent: "The recording event is invalid. Nothing was saved."
        case .invalidTransition: "This recording action no longer matches the saved state."
        case .conflictingIdentity: "This event ID already has different content. The original was preserved."
        case .staleInterval: "This event does not belong to an authorized recording interval."
        case .anotherRecording: "Finish the existing recording before starting one in another workspace."
        case .unsupportedSchema: "This recording store needs a different app version. It has not been reset."
        case .invalidStore:
            "The recording store could not be validated. Preserve it for recovery; it has not been reset."
        case .closed: "Recording storage is closed. Reopen the app to recover saved history."
        case .storage(let code):
            "Local storage failed (SQLite \(code)). Recording is stopped; retry to save the pending action."
        }
    }
}
