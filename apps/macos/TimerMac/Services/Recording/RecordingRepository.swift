import Foundation

protocol RecordingRepository: Sendable {
    func load() async throws -> [RecordingSnapshot]
    func commit(_ event: RecordingEvent) async throws -> RecordingSnapshot
    func delete(_ recordingID: UUID, localScopeID: String) async throws
    func close() async
}
