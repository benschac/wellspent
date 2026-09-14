import Darwin
import Foundation
import Testing

@testable import TimerMac

@MainActor
struct LocalHarnessRuntimeTests {
    @Test
    func restoringDoesNotRegisterAndExplicitConnectDoes() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let runtime = fixture.runtime()
        defer { runtime.stopHelper() }
        #expect(await runtime.connection() == nil)
        #expect(runtime.connectionError == nil)
        #expect(try fixture.commands().isEmpty)
        let connected = try await runtime.connect(scope: "local-fixture")
        #expect(connected.localScopeID == "local-fixture")
        #expect(try fixture.commands().filter { $0 == "connect" }.count == 1)
        let restored = await runtime.connection()
        #expect(restored?.connectionID == connected.connectionID)
        #expect(try fixture.commands().filter { $0 == "connect" }.count == 1)
        try await runtime.revoke()
        #expect(await runtime.connection()?.revoked == true)
        await #expect(throws: LocalHarnessRuntime.Failure.self) { try await runtime.startHelper() }
        #expect(try fixture.commands().contains("serve") == false)
    }

    @Test(arguments: ["malformed", "oversized", "wrongKey", "unknownField"])
    func rejectsBadPrivateConnectionOutput(mode: String) async throws {
        let fixture = try Fixture(mode: mode)
        defer { fixture.remove() }
        let runtime = fixture.runtime()
        #expect(await runtime.connection() == nil)
        #expect(runtime.connectionError != nil)
        #expect(try fixture.commands().contains("connect") == false)
    }

    @Test(.timeLimit(.minutes(1)))
    func restartsOnlyItsOwnedHelperAndStopsItOnRevoke() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let runtime = fixture.runtime()
        defer { runtime.stopHelper() }
        _ = try await runtime.connect(scope: "local-fixture")
        try await runtime.startHelper()
        let first = try await fixture.waitForPID()
        #expect(kill(first, 0) == 0)
        // The PID is published by this test's child under its unique temporary directory.
        #expect(kill(first, SIGKILL) == 0)
        let restarted = try await fixture.waitForPID(differentFrom: first)
        #expect(restarted != first)
        try await runtime.revoke()
        try await fixture.waitForExit(restarted)
        #expect(await runtime.connection()?.revoked == true)
        #expect(try fixture.commands().filter { $0 == "connect" }.count == 1)
    }

    @Test(.timeLimit(.minutes(1)))
    func cancellationTerminatesTheUnresponsiveCommand() async throws {
        let fixture = try Fixture(mode: "hang")
        defer { fixture.remove() }
        let runtime = fixture.runtime()
        let task = Task { await runtime.connection() }
        let pid = try await fixture.waitForPID()
        task.cancel()
        #expect(await task.value == nil)
        try await fixture.waitForExit(pid)
        #expect(try fixture.commands() == ["connection"])
    }

    @Test
    func modelRestoresWithoutInstallationAndDisconnectStopsAdvertisingNoteDelivery() async throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let recording = RecordingModel(repository: RecordingModelRepositoryFixture(), localScopeID: "local-fixture")
        recording.load()
        await recording.waitForIdle()
        recording.startRecording()
        await recording.waitForIdle()
        let model = LocalHarnessModel(recording: recording, runtime: fixture.runtime())
        model.start()
        await model.waitForIdle()
        #expect(try fixture.commands().isEmpty)
        #expect(model.isConnected == false)
        #expect(model.recordingStatus == "Recording active. Connect Codex to submit notes.")
        model.connect()
        await model.waitForIdle()
        #expect(model.isConnected)
        #expect(model.needsRestart)
        model.disconnect()
        await model.waitForIdle()
        #expect(model.isConnected == false)
        #expect(model.recordingStatus == "Recording active. Connect Codex to submit notes.")
        #expect(try fixture.commands().filter { $0 == "connect" }.count == 1)
        await model.stop()
        #expect(await recording.shutdown())
    }

    @Test
    func modelShowsRecoveryForExistingUnreadableConnection() async throws {
        let fixture = try Fixture(mode: "malformed")
        defer { fixture.remove() }
        let recording = RecordingModel(repository: RecordingModelRepositoryFixture())
        let model = LocalHarnessModel(recording: recording, runtime: fixture.runtime())
        model.start()
        await model.waitForIdle()
        #expect(model.hasError)
        #expect(model.isConnected == false)
        #expect(try fixture.commands().contains("connect") == false)
        await model.stop()
    }

    @Test
    func externalRuntimeReadsAndStartsWithoutNodeOrBundledResources() async throws {
        let fixture = try ExternalFixture()
        defer { fixture.remove() }
        try fixture.seedConnection()
        try fixture.heartbeat()
        let runtime = fixture.runtime()
        #expect(await runtime.connection()?.connectionID == fixture.connectionID)
        #expect(runtime.connectionError == nil)
        try await runtime.startHelper()
        runtime.stopHelper()
        #expect(fixture.exists("dev-request.json") == false)
    }

    @Test(arguments: [6.0, -3.0])
    func externalConnectRequiresFreshRunnerHeartbeat(age: Double) async throws {
        let fixture = try ExternalFixture()
        defer { fixture.remove() }
        try fixture.heartbeat(age: age)
        let runtime = fixture.runtime()
        await #expect(throws: LocalHarnessRuntime.Failure.self) { try await runtime.connect(scope: "local-fixture") }
        #expect(fixture.exists("dev-request.json") == false)
    }

    @Test
    func externalConnectAndRevokeAreExplicitCorrelatedRequests() async throws {
        let fixture = try ExternalFixture()
        defer { fixture.remove() }
        try fixture.heartbeat()
        let runtime = fixture.runtime()
        #expect(await runtime.connection() == nil)
        #expect(fixture.exists("dev-request.json") == false)
        let connecting = Task { try await runtime.connect(scope: "local-fixture") }
        let request = try await fixture.request()
        #expect(request["action"] as? String == "connect")
        #expect(request["scope"] as? String == "local-fixture")
        #expect(request["runnerID"] as? String == fixture.runnerID.uuidString.lowercased())
        let id = try #require(request["id"] as? String)
        try fixture.seedConnection()
        try fixture.result(id: id)
        let connected = try await connecting.value
        #expect(connected.connectionID == fixture.connectionID)
        #expect(fixture.exists("dev-request.json") == false)
        let revoking = Task { try await runtime.revoke() }
        let revoke = try await fixture.request()
        #expect(revoke["action"] as? String == "revoke")
        #expect(revoke["scope"] is NSNull)
        try fixture.seedConnection(revoked: true)
        try fixture.result(id: #require(revoke["id"] as? String))
        try await revoking.value
        #expect(await runtime.connection()?.revoked == true)
    }

    @Test
    func externalRequestRejectsMismatchedReplyAndCancellationRemovesOnlyItsRequest() async throws {
        let fixture = try ExternalFixture()
        defer { fixture.remove() }
        try fixture.heartbeat()
        let runtime = fixture.runtime()
        let connecting = Task { try await runtime.connect(scope: "local-fixture") }
        _ = try await fixture.request()
        try fixture.result(id: UUID().uuidString.lowercased())
        try await Task.sleep(for: .milliseconds(150))
        connecting.cancel()
        await #expect(throws: CancellationError.self) { try await connecting.value }
        #expect(fixture.exists("dev-request.json") == false)
    }

    @Test
    func externalRunnerRestartInvalidatesPendingApproval() async throws {
        let fixture = try ExternalFixture()
        defer { fixture.remove() }
        try fixture.heartbeat()
        let runtime = fixture.runtime()
        let connecting = Task { try await runtime.connect(scope: "local-fixture") }
        _ = try await fixture.request()
        try fixture.heartbeat(runner: UUID())
        await #expect(throws: LocalHarnessRuntime.Failure.self) { try await connecting.value }
        #expect(fixture.exists("dev-request.json") == false)
    }

    @Test(arguments: [
        "permissions", "directoryPermissions", "oversized", "symlink", "uninstalled", "differentIdentity",
    ])
    func externalPrivateStateFailsClosed(mode: String) async throws {
        let fixture = try ExternalFixture()
        defer { fixture.remove() }
        try fixture.seedConnection(installed: mode != "uninstalled", differentIdentity: mode == "differentIdentity")
        let connection = fixture.directory.appendingPathComponent("connection.json")
        switch mode {
        case "permissions":
            try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: connection.path)
        case "directoryPermissions":
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fixture.directory.path)
        case "oversized":
            try Data(repeating: 32, count: 16_385).write(to: connection)
        case "symlink":
            let target = fixture.directory.appendingPathComponent("connection-target.json")
            try FileManager.default.moveItem(at: connection, to: target)
            try FileManager.default.createSymbolicLink(at: connection, withDestinationURL: target)
        default: break
        }
        let runtime = fixture.runtime()
        #expect(await runtime.connection() == nil)
        #expect(runtime.connectionError != nil)
    }

    @Test
    func externalDevelopmentFailureIsActionableInTheModel() async throws {
        let fixture = try ExternalFixture()
        defer { fixture.remove() }
        let recording = RecordingModel(repository: RecordingModelRepositoryFixture())
        let model = LocalHarnessModel(recording: recording, runtime: fixture.runtime())
        model.connect()
        await model.waitForIdle()
        #expect(model.hasError)
        #expect(model.status.contains("Run b dev"))
        #expect(fixture.exists("dev-request.json") == false)
        await model.stop()
    }

    @Test(.timeLimit(.minutes(1)))
    func externalNativeRequestsInteroperateWithProductionDevRunner() async throws {
        let fixture = try DevRunnerFixture()
        do {
            try await fixture.waitUntilReady()
            let runtime = LocalHarnessRuntime(
                root: fixture.directory, resources: nil, executablePaths: [], managedExternally: true)
            #expect(await runtime.connection() == nil)
            let connection = try await runtime.connect(scope: "local-fixture")
            #expect(connection.localScopeID == "local-fixture")
            try await runtime.startHelper()
            let transport = try LocalHarnessTransport(endpoint: connection.endpoint)
            #expect(try await transport.poll(connection: connection, epoch: UUID(), active: nil).request == nil)
            try await runtime.revoke()
            #expect(await runtime.connection()?.revoked == true)
            runtime.stopHelper()
        } catch {
            await fixture.stop()
            throw error
        }
        await fixture.stop()
    }

    private struct DevRunnerFixture {
        let directory: URL
        let process: Process

        init() throws {
            directory = FileManager.default.temporaryDirectory.appendingPathComponent(
                "wellspent-dev-runner-native-\(UUID())")
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            let candidates =
                ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
                + (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map { "\($0)/node" }
            let node = try #require(candidates.first { FileManager.default.isExecutableFile(atPath: $0) })
            let codex = directory.appendingPathComponent("fixture-codex")
            let fake = "#!\(node)\n" + Self.codexScript
            try Data(fake.utf8).write(to: codex)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: codex.path)
            var repository = URL(fileURLWithPath: #filePath)
            for _ in 0..<6 { repository.deleteLastPathComponent() }
            let devScript = repository.appendingPathComponent("integrations/codex/harness-dev.mjs")
            try #require(FileManager.default.isReadableFile(atPath: devScript.path))
            process = Process()
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = [
                "--input-type=module", "-e", Self.script, "wellspent-dev-native-fixture", devScript.path,
                directory.path, codex.path,
            ]
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try process.run()
        }

        func waitUntilReady() async throws {
            let started = ContinuousClock.now
            while started.duration(to: .now) < .seconds(5) {
                if FileManager.default.fileExists(atPath: directory.appendingPathComponent("dev-heartbeat.json").path) {
                    return
                }
                guard process.isRunning else { throw ExternalFixture.ExternalFailure.noRequest }
                try await Task.sleep(for: .milliseconds(25))
            }
            throw ExternalFixture.ExternalFailure.noRequest
        }

        func stop() async {
            if process.isRunning { process.terminate() }
            let started = ContinuousClock.now
            while process.isRunning, started.duration(to: .now) < .seconds(1) {
                try? await Task.sleep(for: .milliseconds(10))
            }
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            try? FileManager.default.removeItem(at: directory)
        }

        private static let script = #"""
            import {pathToFileURL} from 'node:url';
            const [script, directory, codex] = process.argv.slice(2);
            const {startDevRunner} = await import(pathToFileURL(script));
            const runner = await startDevRunner({directory, resolveCodex: async () => codex, intervalMs:20, heartbeatMs:100});
            process.once('SIGTERM', async () => { await runner.stop(); process.exit(0); });
            """#

        private static let codexScript = #"""
            const fs = require('node:fs');
            const path = require('node:path');
            const args = process.argv.slice(2);
            const file = path.join(__dirname, 'fixture-registration.json');
            if (args[0] !== 'mcp') process.exit(2);
            if (args[1] === 'list') process.stdout.write(fs.existsSync(file) ? fs.readFileSync(file) : '[]');
            else if (args[1] === 'add') {
              fs.writeFileSync(file, JSON.stringify([{name:'wellspent-local', enabled:true,
                transport:{type:'stdio',command:args[4],args:args.slice(5),env:null,env_vars:[],cwd:null}}]), {mode:0o600});
            } else process.exit(2);
            """#
    }

    private struct ExternalFixture {
        let directory: URL
        let connectionID = UUID()
        let runnerID = UUID()

        init() throws {
            directory = FileManager.default.temporaryDirectory.appendingPathComponent(
                "wellspent-external-runtime-\(UUID())")
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
        }

        @MainActor func runtime() -> LocalHarnessRuntime {
            LocalHarnessRuntime(root: directory, resources: nil, executablePaths: [], managedExternally: true)
        }

        func seedConnection(revoked: Bool = false, installed: Bool = true, differentIdentity: Bool = false) throws {
            try write(
                "connection.json",
                [
                    "version": 1, "connectionID": connectionID.uuidString.lowercased(),
                    "key": Data(repeating: 7, count: 32).base64EncodedString(), "endpoint": "http://127.0.0.1:45123",
                    "localScopeID": "local-fixture", "revoked": revoked,
                ])
            try write(
                "registration.json",
                [
                    "connectionID": (differentIdentity ? UUID() : connectionID).uuidString.lowercased(),
                    "command": "/fixture/node", "args": ["/fixture/harness-mcp.mjs", "--root", directory.path],
                    "installed": installed,
                ])
        }

        func heartbeat(age: TimeInterval = 0, runner: UUID? = nil) throws {
            try write(
                "dev-heartbeat.json",
                [
                    "version": 1, "runnerID": (runner ?? runnerID).uuidString.lowercased(),
                    "updatedAt": CodexIntakeContract.timestamp(Date().addingTimeInterval(-age)),
                ])
        }

        func result(id: String, error: String? = nil) throws {
            try write(
                "dev-result.json",
                [
                    "version": 1, "id": id, "status": error == nil ? "ok" : "error",
                    "error": error as Any? ?? NSNull(),
                ])
        }

        func request() async throws -> [String: Any] {
            let started = ContinuousClock.now
            while started.duration(to: .now) < .seconds(3) {
                if let data = try? Data(contentsOf: directory.appendingPathComponent("dev-request.json")),
                    let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                {
                    return fields
                }
                try await Task.sleep(for: .milliseconds(25))
            }
            throw ExternalFailure.noRequest
        }

        func exists(_ name: String) -> Bool {
            FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path)
        }
        func remove() { try? FileManager.default.removeItem(at: directory) }

        private func write(_ name: String, _ value: [String: Any]) throws {
            let file = directory.appendingPathComponent(name)
            try JSONSerialization.data(withJSONObject: value).write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }

        enum ExternalFailure: Error { case noRequest }
    }

    private struct Fixture {
        let directory: URL
        let binaries: URL

        init(mode: String = "normal") throws {
            directory = FileManager.default.temporaryDirectory.appendingPathComponent(
                "wellspent-harness-runtime-\(UUID())")
            binaries = directory.appendingPathComponent("bin")
            try FileManager.default.createDirectory(at: binaries, withIntermediateDirectories: true)
            let candidates =
                ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
                + (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map { "\($0)/node" }
            let node = try #require(candidates.first { FileManager.default.isExecutableFile(atPath: $0) })
            for name in ["node", "codex"] {
                try FileManager.default.createSymbolicLink(
                    atPath: binaries.appendingPathComponent(name).path, withDestinationPath: node)
            }
            try Data(Self.script.utf8).write(to: directory.appendingPathComponent("harness-helper.mjs"))
            try Data(mode.utf8).write(to: directory.appendingPathComponent("mode"))
            if mode != "normal" {
                try Data("{}".utf8).write(to: directory.appendingPathComponent("connection.json"))
            }
        }

        @MainActor func runtime() -> LocalHarnessRuntime {
            LocalHarnessRuntime(root: directory, resources: directory, executablePaths: [binaries.path])
        }

        func commands() throws -> [String] {
            let url = directory.appendingPathComponent("commands")
            guard FileManager.default.fileExists(atPath: url.path) else { return [] }
            return try String(contentsOf: url, encoding: .utf8)
                .split(separator: "\n").map(String.init)
        }

        func waitForPID(differentFrom previous: Int32? = nil) async throws -> Int32 {
            let start = ContinuousClock.now
            while start.duration(to: .now) < .seconds(6) {
                if let text = try? String(contentsOf: directory.appendingPathComponent("pid"), encoding: .utf8),
                    let pid = Int32(text), pid != previous
                {
                    return pid
                }
                try await Task.sleep(for: .milliseconds(25))
            }
            throw FixtureFailure.missingProcess
        }

        func waitForExit(_ pid: Int32) async throws {
            let start = ContinuousClock.now
            while start.duration(to: .now) < .seconds(3) {
                if kill(pid, 0) != 0 { return }
                try await Task.sleep(for: .milliseconds(25))
            }
            throw FixtureFailure.processStillRunning
        }

        func remove() { try? FileManager.default.removeItem(at: directory) }

        enum FixtureFailure: Error { case missingProcess, processStillRunning }

        private static let script = #"""
            import fs from 'node:fs';
            import path from 'node:path';
            const [flag, root, command] = process.argv.slice(2);
            if (flag !== '--root') process.exit(2);
            const file = name => path.join(root, name);
            fs.appendFileSync(file('commands'), `${command}\n`);
            const mode = fs.readFileSync(file('mode'), 'utf8');
            const saved = () => JSON.parse(fs.readFileSync(file('connection.json'), 'utf8'));
            const seed = {version:1, connectionID:'00000000-0000-4000-8000-000000000001',
              key:Buffer.alloc(32, 7).toString('base64'), endpoint:'http://127.0.0.1:45123',
              localScopeID:'local-fixture', revoked:false};
            if (command === 'connection') {
              if (mode === 'hang') {
                fs.writeFileSync(file('pid'), String(process.pid)); setInterval(() => {}, 1000);
              } else if (mode === 'malformed') process.stdout.write('{invalid');
              else if (mode === 'oversized') process.stdout.write('x'.repeat(65536));
              else if (mode === 'wrongKey') process.stdout.write(JSON.stringify({...seed, key:'AA=='}));
              else if (mode === 'unknownField') process.stdout.write(JSON.stringify({...seed, unexpected:true}));
              else process.stdout.write(JSON.stringify(saved()));
            } else if (command === 'connect') {
              fs.writeFileSync(file('connection.json'), JSON.stringify(seed));
            } else if (command === 'revoke') {
              fs.writeFileSync(file('connection.json'), JSON.stringify({...saved(), revoked:true}));
            } else if (command === 'serve') {
              fs.writeFileSync(file('pid'), String(process.pid)); setInterval(() => {}, 1000);
            } else process.exit(3);
            """#
    }
}
