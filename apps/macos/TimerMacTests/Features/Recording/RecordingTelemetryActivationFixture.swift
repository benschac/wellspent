import Darwin
import Foundation
import Testing

@testable import TimerMac

/// The source, supervisor mailbox, spool and SQLite database all belong to this fixture.
/// The production supervisor and native HTTP transport remain unmodified.
@MainActor
final class RecordingTelemetryActivationFixture {
    let root: URL
    let source: URL
    let store: URL
    let runtime: LocalHarnessRuntime
    private(set) var port = 0
    private var process: Process?
    private let node: URL
    private let script: URL

    init() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("wellspent-telemetry-activation-\(UUID())")
        try FileManager.default.createDirectory(
            at: temporary, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        // Foundation may retain macOS /var aliases. Use the same physical identity as Node realpath.
        let physicalPath = Darwin.realpath(temporary.path, nil)
        let resolved = try #require(physicalPath)
        defer { free(resolved) }
        root = URL(fileURLWithPath: String(cString: resolved))
        source = root.appendingPathComponent("selected-synthetic.jsonl")
        store = root.appendingPathComponent("recordings.sqlite")
        try Data("SYNTHETIC_HISTORY_MUST_NOT_BE_IMPORTED\n".utf8).write(to: source)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: source.path)
        runtime = LocalHarnessRuntime(root: root, managedExternally: true)
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { repository.deleteLastPathComponent() }
        script = repository.appendingPathComponent("apps/macos/scripts/telemetry-activation-fixture.mjs")
        let candidates =
            (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":")
            .map { String($0) + "/node" } + ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
        node = URL(fileURLWithPath: try #require(candidates.first { FileManager.default.isExecutableFile(atPath: $0) }))
    }

    func start() async throws {
        try? FileManager.default.removeItem(at: root.appendingPathComponent("test-ready"))
        let child = Process()
        child.executableURL = node
        child.arguments = [script.path, root.path]
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        try child.run()
        process = child
        for _ in 0..<200 {
            if let value = try? String(contentsOf: root.appendingPathComponent("test-ready"), encoding: .utf8),
                let number = Int(value), (1024...65535).contains(number)
            {
                port = number
                return
            }
            try #require(
                child.isRunning, "Synthetic supervisor exited before becoming ready; rebuild the harness bundle")
            try await Task.sleep(for: .milliseconds(25))
        }
        Issue.record("Synthetic supervisor failed to become ready within five seconds")
        throw LocalHarnessRuntime.Failure.timedOut
    }

    func stopProcess() async throws {
        guard let process else { return }
        if process.isRunning { process.terminate() }
        for _ in 0..<200 {
            if !process.isRunning {
                self.process = nil
                return
            }
            try await Task.sleep(for: .milliseconds(25))
        }
        // Terminate only this fixture's child process if graceful shutdown fails.
        kill(process.processIdentifier, SIGKILL)
        self.process = nil
        throw LocalHarnessRuntime.Failure.timedOut
    }

    func cleanup() async {
        try? await stopProcess()
        try? FileManager.default.removeItem(at: root)
    }

    func makeModel() -> RecordingModel {
        RecordingModel(
            repository: SQLiteRecordingRepository(url: store), localScopeID: "synthetic-activation",
            telemetryRuntime: runtime)
    }

    func prepareSelection(_ model: RecordingModel, source selected: URL? = nil) throws {
        let selected = selected ?? source
        model.telemetry.filePath = selected.path
        model.telemetry.threadID = "synthetic-activation-thread"
        model.telemetry.sessionID = "synthetic-activation-session"
        model.telemetry.eofOffset = String(try Data(contentsOf: selected).count)
        model.telemetry.port = port
    }

    func append(turn: String = "synthetic-turn", to selected: URL? = nil) throws {
        let timestamp = CodexIntakeContract.timestamp(Date())
        let records: [[String: Any]] = [
            [
                "type": "turn_context", "timestamp": timestamp,
                "payload": [
                    "turn_id": turn, "root_turn_id": "synthetic-root", "model": "gpt-6-sol", "effort": "high",
                    "developer_instructions": "SYNTHETIC_PRIVATE_CANARY",
                ],
            ],
            [
                "type": "token_usage_record", "timestamp": timestamp,
                "payload": [
                    "thread_id": "synthetic-activation-thread", "session_id": "synthetic-activation-session",
                    "turn_id": turn, "root_turn_id": "synthetic-root", "response_id": "response-\(turn)",
                    "usage": [
                        "input_tokens": 1200, "cached_input_tokens": 800, "output_tokens": 90,
                        "reasoning_output_tokens": 30, "total_tokens": 1290,
                    ],
                    "thread_token_usage": ["total_tokens": 999999], "model": "SYNTHETIC_EXECUTION_UNKNOWN",
                ],
            ],
        ]
        let handle = try FileHandle(forWritingTo: selected ?? source)
        defer { try? handle.close() }
        try handle.seekToEnd()
        for record in records {
            try handle.write(contentsOf: JSONSerialization.data(withJSONObject: record))
            try handle.write(contentsOf: Data([10]))
        }
    }

    func startRecording(_ model: RecordingModel) async throws {
        model.load()
        await model.waitForIdle()
        model.startRecording()
        await model.waitForIdle()
        try #require(model.acceptingEvents)
        try prepareSelection(model)
    }

    func authorize(_ model: RecordingModel) async throws {
        try #require(model.telemetry.canAuthorize)
        model.telemetry.authorize()
        var reported: Set<String> = []
        while model.telemetry.isBusy {
            if let data = try? Data(contentsOf: root.appendingPathComponent("telemetry-result.json")),
                let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let error = fields["error"] as? String, reported.insert(error).inserted
            {
                // Never print packet keys, bodies, source paths or arbitrary helper diagnostics.
                print("C4 synthetic supervisor result code: \(error)")
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        await model.telemetry.waitForIdle()
        try #require(model.telemetry.isCollecting, Comment(rawValue: model.telemetry.status))
    }
}
