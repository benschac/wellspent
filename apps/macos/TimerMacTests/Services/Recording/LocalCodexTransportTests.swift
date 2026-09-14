import Foundation
import Testing

@testable import TimerMac

struct LocalCodexTransportTests {
    @Test(arguments: [
        "http://localhost:1234", "http://127.0.0.2:1234", "http://[::1]:1234", "https://127.0.0.1:1234",
        "http://127.0.0.1", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:01234",
        "http://127.0.0.1:1234/", "http://127.0.0.1:1234?secret=x", "http://127.0.0.1:1234#fragment",
        "http://user:password@127.0.0.1:1234", "http://2130706433:1234", "http://127.0.0.1:1234\n",
    ])
    func rejectsEveryOriginExceptExactPairedLiteral(endpoint: String) {
        #expect(throws: LocalCodexTransport.Failure.invalidEndpoint) { try LocalCodexTransport(endpoint: endpoint) }
    }

    @Test
    func authenticatesFreshRequestsAndNeverSendsTheKey() async throws {
        let server = try Server(mode: "normal")
        defer { server.stop() }
        let transport = try LocalCodexTransport(endpoint: server.endpoint)
        let bindingID = UUID()
        let first = try await transport.poll(bindingID: bindingID, key: Self.key)
        let second = try await transport.poll(bindingID: bindingID, key: Self.key)
        #expect(first.packet == nil)
        #expect(first.status.pending == 1)
        #expect(second.status.pending == 2)
        #expect(try await transport.status(bindingID: bindingID, key: Self.key).pending == 3)
    }

    @Test(arguments: [
        "redirect", "advertisedOversize", "chunkedOversize", "unknownReason", "unknownField", "badPacket",
    ])
    func rejectsMaliciousResponses(mode: String) async throws {
        let server = try Server(mode: mode)
        defer { server.stop() }
        let transport = try LocalCodexTransport(endpoint: server.endpoint)
        do {
            _ = try await transport.poll(bindingID: UUID(), key: Self.key)
            Issue.record("A malicious helper response was accepted: \(mode)")
        } catch let failure as LocalCodexTransport.Failure {
            switch mode {
            case "redirect": #expect(failure == .http(302))
            case "advertisedOversize", "chunkedOversize": #expect(failure == .oversizedResponse)
            default: #expect(failure == .invalidResponse)
            }
        }
    }

    @Test
    func rejectsInvalidKeyBeforeConnecting() async throws {
        let transport = try LocalCodexTransport(endpoint: "http://127.0.0.1:1")
        await #expect(throws: LocalCodexTransport.Failure.invalidKey) {
            try await transport.poll(bindingID: UUID(), key: Data())
        }
    }

    @Test
    func cancellationStopsAnUnansweredRequest() async throws {
        let server = try Server(mode: "silent")
        defer { server.stop() }
        let transport = try LocalCodexTransport(endpoint: server.endpoint)
        let task = Task { try await transport.poll(bindingID: UUID(), key: Self.key) }
        try await Task.sleep(for: .milliseconds(100))
        task.cancel()
        do {
            _ = try await task.value
            Issue.record("Cancelled transport unexpectedly succeeded")
        } catch is CancellationError {
            // Cancellation before the network operation starts.
        } catch let error as URLError {
            #expect(error.code == .cancelled)
        }
    }

    private static let key = Data(repeating: 7, count: 32)

    /// Real loopback sockets exercise URLSession's redirects and streaming limits.
    /// No user's helper state or installed hook configuration is accessed.
    private struct Server {
        enum StartupFailure: Error {
            case nodeUnavailable
            case failed(String)
        }

        let process: Process
        let endpoint: String

        init(mode: String) throws {
            let process = Process()
            let output = Pipe()
            let errors = Pipe()
            let pathCandidates = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":")
                .map { String($0) + "/node" }
            let candidates =
                pathCandidates + [
                    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/node").path,
                    "/opt/homebrew/bin/node", "/usr/local/bin/node",
                ]
            guard let node = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
                throw StartupFailure.nodeUnavailable
            }
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = ["-e", Self.script, mode]
            process.standardOutput = output
            process.standardError = errors
            try process.run()
            let line = output.fileHandleForReading.availableData
            guard let portText = String(data: line, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                let port = Int(portText), (1...65535).contains(port)
            else {
                if process.isRunning { process.terminate() }
                process.waitUntilExit()
                let stderr = errors.fileHandleForReading.readDataToEndOfFile().prefix(4096)
                throw StartupFailure.failed(String(decoding: stderr, as: UTF8.self))
            }
            self.process = process
            endpoint = "http://127.0.0.1:\(port)"
        }

        func stop() {
            if process.isRunning { process.terminate() }
            process.waitUntilExit()
        }

        private static let script = #"""
            const http = require('node:http');
            const {createHmac} = require('node:crypto');
            const mode = process.argv[1];
            const nonces = new Set();
            const server = http.createServer((req, res) => {
              let bytes = '';
              req.on('data', b => { bytes += b; });
              req.on('end', () => {
                try {
                  const packet = JSON.parse(bytes);
                  const body = Buffer.from(packet.body, 'base64');
                  const domain = req.url.slice('/v1/'.length);
                  const expected = createHmac('sha256', Buffer.alloc(32, 7))
                    .update(`wellspent-c3a-${domain}\0`).update(body).digest('base64');
                  const value = JSON.parse(body);
                  if (packet.mac !== expected || req.method !== 'POST' || req.headers.authorization ||
                      req.headers.cookie || nonces.has(value.nonce) || value.version !== 1 ||
                      Math.abs(Date.now() - Date.parse(value.issuedAt)) > 30000) throw Error('request');
                  nonces.add(value.nonce);
                  const status = {pending: nonces.size, quarantined: 0, unassociated: 0, reasons: {}};
                  res.setHeader('Content-Type', 'application/json');
                  if (mode === 'silent') return;
                  if (mode === 'redirect') {
                    res.writeHead(302, {Location: `http://127.0.0.1:${server.address().port}/target`});
                    return res.end('{}');
                  }
                  if (mode === 'advertisedOversize') {
                    res.setHeader('Content-Length', '1048576'); return res.end('{}');
                  }
                  if (mode === 'chunkedOversize') {
                    res.write(' '.repeat(32768)); return res.end(' ');
                  }
                  if (mode === 'unknownReason') status.reasons['private content'] = 1;
                  const response = {packet: null, status};
                  if (mode === 'unknownField') response.secret = 'must reject';
                  if (mode === 'badPacket') response.packet = {body: '***', mac: '***'};
                  res.end(JSON.stringify(domain === 'status' ? status : response));
                } catch { res.writeHead(401); res.end('{}'); }
              });
            });
            server.listen(0, '127.0.0.1', () => console.log(server.address().port));
            """#
    }
}
