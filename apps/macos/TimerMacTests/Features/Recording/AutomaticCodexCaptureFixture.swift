import Foundation
import Testing

@testable import TimerMac

/// Reuses the selected-source fixture's real supervisor, private spool and HTTP listener.
/// Every file, identity and native database in this fixture is disposable and synthetic.
@MainActor
final class AutomaticCodexCaptureFixture {
    let activation: RecordingTelemetryActivationFixture
    let directory: URL
    let preferences: UserDefaults
    private let preferenceSuite: String

    init() throws {
        activation = try RecordingTelemetryActivationFixture()
        preferenceSuite = "wellspent.synthetic.automatic-codex.\(UUID())"
        preferences = try #require(UserDefaults(suiteName: preferenceSuite))
        directory = activation.root.appendingPathComponent("synthetic-codex-sessions")
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    }

    func start() async throws { try await activation.start() }
    func cleanup() async {
        preferences.removePersistentDomain(forName: preferenceSuite)
        await activation.cleanup()
    }

    func makeModel() -> RecordingModel {
        let model = RecordingModel(
            repository: SQLiteRecordingRepository(url: activation.store), localScopeID: "synthetic-automatic",
            telemetryRuntime: activation.runtime, telemetryPreferences: preferences)
        model.telemetry.automatic.port = activation.port
        return model
    }

    func load(_ model: RecordingModel) async {
        model.load()
        await model.waitForIdle()
    }

    func authorize(_ model: RecordingModel, remember: Bool = false) throws {
        try model.telemetry.automatic.authorizeDirectory(directory, remember: remember)
        model.telemetry.automatic.includeCodexActivity = true
    }

    @discardableResult
    func createSession(_ name: String, version: String = "0.157.1", in parent: URL? = nil) throws -> URL {
        let source = (parent ?? directory).appendingPathComponent("rollout-\(name).jsonl")
        let header: [String: Any] = [
            "type": "session_meta", "timestamp": CodexIntakeContract.timestamp(Date()),
            "payload": [
                "id": "synthetic-thread-\(name)", "session_id": "synthetic-session-\(name)",
                "cli_version": version, "instructions": "SYNTHETIC_HEADER_CONTENT_MUST_NOT_BE_RETAINED",
            ],
        ]
        var bytes = try JSONSerialization.data(withJSONObject: header)
        bytes.append(10)
        try bytes.write(to: source)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: source.path)
        return source
    }

    func append(_ session: String, turn: String, to source: URL? = nil) throws {
        let timestamp = CodexIntakeContract.timestamp(Date())
        let records: [[String: Any]] = [
            [
                "type": "turn_context", "timestamp": timestamp,
                "payload": [
                    "turn_id": turn, "root_turn_id": "synthetic-root-\(session)",
                    "model": "gpt-6-sol", "effort": "high", "developer_instructions": "SYNTHETIC_PRIVATE_CANARY",
                ],
            ],
            [
                "type": "token_usage_record", "timestamp": timestamp,
                "payload": [
                    "thread_id": "synthetic-thread-\(session)", "session_id": "synthetic-session-\(session)",
                    "turn_id": turn, "root_turn_id": "synthetic-root-\(session)", "response_id": "response-\(turn)",
                    "usage": [
                        "input_tokens": 1200, "cached_input_tokens": 800, "output_tokens": 90,
                        "reasoning_output_tokens": 30, "total_tokens": 1290,
                    ],
                    "thread_token_usage": ["total_tokens": 999999], "model": "SYNTHETIC_EXECUTION_UNKNOWN",
                ],
            ],
        ]
        let destination = source ?? directory.appendingPathComponent("rollout-\(session).jsonl")
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }
        try handle.seekToEnd()
        for record in records {
            try handle.write(contentsOf: JSONSerialization.data(withJSONObject: record))
            try handle.write(contentsOf: Data([10]))
        }
    }

    func waitForSources(_ count: Int, model: RecordingModel) async throws {
        for _ in 0..<40 {
            await model.telemetry.automatic.waitForIdle()
            await model.telemetry.automatic.pollOnce()
            if model.telemetry.automatic.sourceCount == count && model.telemetry.automatic.isCollecting { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        try #require(
            model.telemetry.automatic.sourceCount == count && model.telemetry.automatic.isCollecting,
            Comment(rawValue: model.telemetry.automatic.status))
    }

    func read(_ model: RecordingModel) async {
        await model.telemetry.automatic.waitForIdle()
        await model.telemetry.automatic.pollOnce()
    }

    /// Match the UI's disabled-state gate while real background HTTP intake may own the model.
    /// Keep the enabled check and action in the same MainActor turn; waitForIdle alone can go stale.
    func performEnabledAction(_ model: RecordingModel, _ action: @MainActor () -> Void) async throws {
        for _ in 0..<200 {
            if model.canAct {
                action()
                await model.waitForIdle()
                return
            }
            try await Task.sleep(for: .milliseconds(25))
        }
        try #require(model.canAct, "Recording controls did not become enabled within five seconds")
        action()
        await model.waitForIdle()
    }

    func drain(_ model: RecordingModel, polls: Int = 4) async {
        await model.waitForIdle()
        await model.telemetry.automatic.waitForIdle()
        for _ in 0..<polls { _ = await model.codex.pollOnce() }
    }
}
