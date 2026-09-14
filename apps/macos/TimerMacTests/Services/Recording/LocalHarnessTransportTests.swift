import Foundation
import Testing

@testable import TimerMac

@MainActor
struct LocalHarnessTransportTests {
    @Test(.timeLimit(.minutes(1)))
    func productionNodeHelperAuthenticatesNativePollAndDurableAcknowledgement() async throws {
        let fixture = try Fixture()
        defer { fixture.stop() }
        let connection = try await fixture.ready()
        let transport = try LocalHarnessTransport(endpoint: connection.endpoint)
        let epoch = UUID()
        let store = try RecordingStoreFixture()
        defer { store.remove() }
        let recording = RecordingModel(
            repository: SQLiteRecordingRepository(url: store.url), localScopeID: "wire-fixture")
        recording.load()
        await recording.waitForIdle()
        recording.startForegroundApplicationRecording()
        await recording.waitForIdle()
        let active = try #require(recording.activeHarnessInterval)
        let empty = try await transport.poll(connection: connection, epoch: epoch, active: active)
        #expect(empty.request == nil)
        #expect(empty.discovered)
        let eventID = UUID()
        try fixture.submit(eventID)
        let packet = try await waitForRequest(transport, connection: connection, epoch: epoch, active: active)
        let note = try LocalHarnessContract.note(packet, connection: connection)
        #expect(note.eventID == eventID)
        #expect(note.epoch == epoch)
        #expect(note.recordingID == active.recordingID)
        #expect(note.intervalID == active.intervalID)
        let saved = try await recording.receiveWorkNote(packet, connection: connection, epoch: epoch)
        let retry = try await recording.receiveWorkNote(packet, connection: connection, epoch: epoch)
        #expect(retry == saved)
        #expect(recording.current?.events.filter { $0.id == eventID }.count == 1)
        try await transport.complete(
            connection: connection, request: packet, note: note, status: "acknowledged", reason: "committed",
            nativeReceivedAt: saved.stamp.wall)
        let receipt = try await fixture.result(eventID)
        #expect(receipt["status"] as? String == "acknowledged")
        #expect(receipt["nativeReceivedAt"] as? String == CodexIntakeContract.timestamp(saved.stamp.wall))
        recording.pause()
        await recording.waitForIdle()
        #expect(try await transport.poll(connection: connection, epoch: epoch, active: nil).request == nil)
        let inactiveID = UUID()
        try fixture.submit(inactiveID)
        let inactiveReceipt = try await fixture.result(inactiveID)
        #expect(inactiveReceipt["status"] as? String == "rejected")
        #expect(inactiveReceipt["reason"] as? String == "no_active_recording")
        #expect(await recording.shutdown())
    }

    private func waitForRequest(
        _ transport: LocalHarnessTransport, connection: LocalHarnessContract.Connection,
        epoch: UUID, active: LocalHarnessContract.Active
    ) async throws -> CodexIntakeContract.Packet {
        let start = ContinuousClock.now
        while start.duration(to: .now) < .seconds(5) {
            if let request = try await transport.poll(connection: connection, epoch: epoch, active: active).request {
                return request
            }
            try await Task.sleep(for: .milliseconds(25))
        }
        throw Fixture.Failure.timedOut
    }

    /// Runs production bundled helper code with only seeded disposable connection state.
    /// The test never calls `connect`, invokes Codex, or accesses a user's harness root.
    private struct Fixture {
        enum Failure: Error {
            case timedOut
            case childExited(String)
        }
        let directory: URL
        let process: Process
        let errors: Pipe

        init() throws {
            directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("wellspent-harness-wire-\(UUID())").resolvingSymlinksInPath()
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            let resources = try #require(Bundle.main.resourceURL?.appendingPathComponent("LocalHarness"))
            let script = resources.appendingPathComponent("harness-helper.mjs")
            try #require(FileManager.default.isReadableFile(atPath: script.path))
            let candidates =
                ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
                + (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map { "\($0)/node" }
            let node = try #require(candidates.first { FileManager.default.isExecutableFile(atPath: $0) })
            process = Process()
            errors = Pipe()
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = [
                "--input-type=module", "-e", Self.script, "wellspent-wire-fixture", script.path, directory.path,
            ]
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = FileHandle.nullDevice
            process.standardError = errors
            try process.run()
            try errors.fileHandleForWriting.close()
        }

        func ready() async throws -> LocalHarnessContract.Connection {
            try JSONDecoder().decode(LocalHarnessContract.Connection.self, from: await waitForFile("ready.json"))
        }

        func submit(_ eventID: UUID) throws {
            let input = ["id": eventID.uuidString.lowercased(), "text": "Explicit local fixture note"]
            try JSONSerialization.data(withJSONObject: input).write(
                to: directory.appendingPathComponent("submit-\(eventID.uuidString.lowercased()).json"), options: .atomic
            )
        }

        func result(_ eventID: UUID) async throws -> [String: Any] {
            let data = try await waitForFile("result-\(eventID.uuidString.lowercased()).json")
            return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }

        private func waitForFile(_ name: String) async throws -> Data {
            let start = ContinuousClock.now
            while start.duration(to: .now) < .seconds(8) {
                if let data = try? Data(contentsOf: directory.appendingPathComponent(name)) { return data }
                guard process.isRunning else {
                    let diagnostics = try errors.fileHandleForReading.read(upToCount: 4096) ?? Data()
                    throw Failure.childExited(String(decoding: diagnostics, as: UTF8.self))
                }
                try await Task.sleep(for: .milliseconds(25))
            }
            throw Failure.timedOut
        }

        func stop() {
            if process.isRunning { process.terminate() }
            process.waitUntilExit()
            try? errors.fileHandleForReading.close()
            try? FileManager.default.removeItem(at: directory)
        }

        private static let script = #"""
            import fs from 'node:fs/promises';
            import path from 'node:path';
            import {pathToFileURL} from 'node:url';
            import {createServer} from 'node:net';
            const [script, directory] = process.argv.slice(2);
            const {openHarnessRoot, serve, discover, logWork} = await import(pathToFileURL(script));
            const {publish} = await import(pathToFileURL(path.join(path.dirname(script), 'local-helper.mjs')));
            const root = await openHarnessRoot(await fs.realpath(directory));
            const reservation = createServer();
            await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
            const port = reservation.address().port;
            await new Promise(resolve => reservation.close(resolve));
            const connection = {version:1, connectionID:'00000000-0000-4000-8000-000000000001',
              key:Buffer.alloc(32, 7).toString('base64'), endpoint:`http://127.0.0.1:${port}`,
              localScopeID:'wire-fixture', revoked:false};
            await publish(path.join(root, 'connection.json'), connection);
            await discover(root);
            await serve(root);
            await fs.writeFile(path.join(root, 'ready.json'), JSON.stringify(connection), {mode:0o600});
            const handled = new Set();
            setInterval(async () => {
              for (const name of await fs.readdir(root)) {
                if (!/^submit-[a-f0-9-]{36}\.json$/.test(name) || handled.has(name)) continue;
                handled.add(name);
                const input = JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
                logWork(root, input).then(result => fs.writeFile(path.join(root, `result-${input.id}.json`),
                  JSON.stringify(result), {mode:0o600})).catch(error => { console.error(error); process.exit(2); });
              }
            }, 20);
            """#
    }
}
