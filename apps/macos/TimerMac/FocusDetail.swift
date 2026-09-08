import Foundation

struct FocusDetail: Decodable, Sendable {
    let session: FocusSession
    let events: [FocusWorkEvent]
    let generatedRecap: String
    let segmentsTruncated: Bool
}
