import Darwin
import Foundation

/// Owns only the helper it launches. Registration is performed exclusively by explicit UI Connect.
@MainActor
final class LocalHarnessRuntime {
    enum Failure: Error, LocalizedError {
        case nodeUnavailable, codexUnavailable, resourcesUnavailable, commandFailed, timedOut, invalidConnection
        case devServerUnavailable, privateStateInvalid, devRequestBusy, mcpNameConflict, scopeConflict

        var errorDescription: String? {
            switch self {
            case .nodeUnavailable: "Install Node.js to connect the local AI Harness."
            case .codexUnavailable: "Install the Codex CLI to connect the local AI Harness."
            case .resourcesUnavailable: "The local AI Harness resources are missing from this app."
            case .commandFailed: "The local AI Harness command failed. Existing local data was preserved."
            case .timedOut: "The local AI Harness command timed out. Try again."
            case .invalidConnection: "The local AI Harness connection is unavailable or invalid."
            case .devServerUnavailable: "Run b dev from the timer repository, then retry Connect."
            case .privateStateInvalid:
                "The local AI Harness development files are invalid or not private. Restart b dev, then retry Connect."
            case .devRequestBusy: "A local AI Harness request is already running. Wait for it to finish, then retry."
            case .mcpNameConflict:
                "The wellspent-local name is used by another Codex connection. Resolve that conflict, then retry Connect."
            case .scopeConflict:
                "This AI Harness connection belongs to another local scope. Use its original scope before reconnecting."
            }
        }
    }

    private let root: URL
    private let resources: URL?
    private let executablePaths: [String]?
    private let managedExternally: Bool
    private var helper: Process?
    private var supervisor: Task<Void, Never>?
    private var generation = UUID()
    private(set) var connectionError: String?

    init(
        root: URL? = nil,
        resources: URL? = Bundle.main.resourceURL?.appendingPathComponent("LocalHarness"),
        executablePaths: [String]? = nil,
        managedExternally: Bool? = nil
    ) {
        let resolvedRoot =
            root
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(
                ".config/wellspent/codex-harness")
        self.root = resolvedRoot
        self.resources = resources
        self.executablePaths = executablePaths
        self.managedExternally =
            managedExternally
            ?? (resolvedRoot.path.contains("/Library/Containers/")
                || (root == nil && ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil))
    }

    func connection() async -> LocalHarnessContract.Connection? {
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("connection.json").path) else {
            connectionError = nil
            return nil
        }
        do {
            let data = managedExternally ? try privateData("connection.json") : try await command(["connection"])
            guard let fields = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                Set(fields.keys) == ["version", "connectionID", "key", "endpoint", "localScopeID", "revoked"]
            else { throw Failure.invalidConnection }
            let connection = try JSONDecoder().decode(LocalHarnessContract.Connection.self, from: data)
            try connection.validate()
            guard validScope(connection.localScopeID) else { throw Failure.invalidConnection }
            if managedExternally {
                let registration: Registration = try privateValue(
                    "registration.json", keys: ["connectionID", "command", "args", "installed"])
                guard registration.installed, registration.connectionID == connection.connectionID,
                    registration.command.hasPrefix("/"), registration.args.count == 3,
                    registration.args[0].hasPrefix("/"), registration.args[1] == "--root",
                    URL(fileURLWithPath: registration.args[2]).resolvingSymlinksInPath()
                        == root.resolvingSymlinksInPath()
                else { throw Failure.invalidConnection }
            }
            connectionError = nil
            return connection
        } catch is CancellationError {
            return nil
        } catch {
            // This stdout contains the pairing key. Never surface bytes or subprocess diagnostics.
            connectionError =
                (error as? Failure)?.errorDescription
                ?? "The saved AI Harness connection could not be read. Repair the connection to recover."
            return nil
        }
    }

    func connect(scope: String) async throws -> LocalHarnessContract.Connection {
        guard validScope(scope) else { throw Failure.invalidConnection }
        if managedExternally {
            try await externalCommand(action: "connect", scope: scope)
            guard let connection = await connection(), !connection.revoked, connection.localScopeID == scope else {
                throw Failure.invalidConnection
            }
            return connection
        }
        guard let codex = executable("codex") else { throw Failure.codexUnavailable }
        guard let node = executable("node") else { throw Failure.nodeUnavailable }
        _ = try await command(["connect", "--scope", scope, "--codex", codex.path, "--node", node.path])
        guard let connection = await connection(), !connection.revoked, connection.localScopeID == scope else {
            throw Failure.invalidConnection
        }
        return connection
    }

    func revoke() async throws {
        stopHelper()
        if managedExternally {
            try await externalCommand(action: "revoke", scope: nil)
        } else {
            _ = try await command(["revoke"])
        }
    }

    func startHelper() async throws {
        if managedExternally {
            _ = try heartbeat()
            guard let connection = await connection(), !connection.revoked else { throw Failure.invalidConnection }
            return
        }
        let token = generation
        guard let connection = await connection(), !connection.revoked else { throw Failure.invalidConnection }
        try Task.checkCancellation()
        guard generation == token else { throw CancellationError() }
        try launchHelper()
        guard supervisor == nil else { return }
        supervisor = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
                guard self != nil else { return }
                await self?.restartHelperIfNeeded(generation: token)
            }
        }
    }

    func stopHelper() {
        generation = UUID()
        supervisor?.cancel()
        supervisor = nil
        if let helper, helper.isRunning {
            // Signal only the Process instance we own, never an arbitrary listener on the port.
            helper.terminate()
        }
        helper = nil
    }

    private func restartHelperIfNeeded(generation token: UUID) async {
        guard generation == token, helper?.isRunning != true else { return }
        guard let connection = await connection(), !connection.revoked,
            generation == token, !Task.isCancelled
        else { return }
        // A bind conflict may mean a user-owned helper is already serving this connection.
        // The authenticated transport establishes that peer's identity; never terminate it.
        try? launchHelper()
    }

    private func launchHelper() throws {
        guard helper?.isRunning != true else { return }
        let process = try process(arguments: ["serve"])
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { throw Failure.commandFailed }
        helper = process
    }

    private func process(arguments: [String]) throws -> Process {
        guard let node = executable("node") else { throw Failure.nodeUnavailable }
        guard let resources else { throw Failure.resourcesUnavailable }
        let script = resources.appendingPathComponent("harness-helper.mjs")
        guard FileManager.default.isReadableFile(atPath: script.path) else { throw Failure.resourcesUnavailable }
        let process = Process()
        process.executableURL = node
        process.arguments = [script.path, "--root", root.path] + arguments
        process.standardInput = FileHandle.nullDevice
        return process
    }

    /// Nonblocking pipe reads bound secret output in memory. Async polling avoids waitUntilExit
    /// and readDataToEndOfFile, both of which can hang the UI on an unresponsive child.
    private func command(_ arguments: [String]) async throws -> Data {
        try Task.checkCancellation()
        let process = try process(arguments: arguments)
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        let descriptor = pipe.fileHandleForReading.fileDescriptor
        guard fcntl(descriptor, F_SETFL, O_NONBLOCK) != -1 else { throw Failure.commandFailed }
        defer {
            try? pipe.fileHandleForReading.close()
            try? pipe.fileHandleForWriting.close()
            if process.isRunning {
                // This is a bounded one-shot command, and this PID belongs to this Process.
                kill(process.processIdentifier, SIGKILL)
            }
        }
        do { try process.run() } catch { throw Failure.commandFailed }
        try? pipe.fileHandleForWriting.close()
        let started = ContinuousClock.now
        var output = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            try Task.checkCancellation()
            guard started.duration(to: .now) < .seconds(15) else { throw Failure.timedOut }
            let finished = !process.isRunning
            while true {
                let count = read(descriptor, &buffer, buffer.count)
                if count > 0 {
                    guard output.count + count <= 32 * 1024 else { throw Failure.commandFailed }
                    output.append(contentsOf: buffer.prefix(count))
                } else if count == 0 || errno == EAGAIN || errno == EWOULDBLOCK {
                    break
                } else if errno != EINTR {
                    throw Failure.commandFailed
                }
            }
            if finished {
                guard process.terminationStatus == 0 else { throw Failure.commandFailed }
                return output
            }
            try await Task.sleep(for: .milliseconds(25))
        }
    }

    private func executable(_ name: String) -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let directories =
            executablePaths ?? [
                home.appendingPathComponent(".local/bin").path,
                home.appendingPathComponent(".bun/bin").path,
                "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
            ] + (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        for directory in directories where directory.hasPrefix("/") {
            let url = URL(fileURLWithPath: directory).appendingPathComponent(name)
            if FileManager.default.isExecutableFile(atPath: url.path) { return url }
        }
        return nil
    }

    private struct Registration: Decodable {
        let connectionID: UUID
        let command: String
        let args: [String]
        let installed: Bool
    }

    private struct Heartbeat: Decodable {
        let version: Int
        let runnerID: UUID
        let updatedAt: String
    }

    private struct DevRequest: Codable {
        let version: Int
        let id: UUID
        let runnerID: UUID
        let action: String
        let scope: String?
        let requestedAt: String
    }

    private struct DevResult: Decodable {
        let version: Int
        let id: UUID
        let status: String
        let error: String?
    }

    private func validScope(_ scope: String) -> Bool {
        !scope.isEmpty && scope.utf8.count <= 200
            && !scope.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
    }

    private func heartbeat() throws -> Heartbeat {
        do {
            let value: Heartbeat = try privateValue("dev-heartbeat.json", keys: ["version", "runnerID", "updatedAt"])
            let age = Date().timeIntervalSince(try CodexIntakeContract.date(value.updatedAt))
            guard value.version == 1, (-1...5).contains(age) else { throw Failure.devServerUnavailable }
            return value
        } catch { throw Failure.devServerUnavailable }
    }

    private func externalCommand(action: String, scope: String?) async throws {
        try Task.checkCancellation()
        let runner = try heartbeat()
        if let existing: DevRequest = try optionalPrivateValue(
            "dev-request.json", keys: ["version", "id", "runnerID", "action", "scope", "requestedAt"]),
            existing.runnerID == runner.runnerID,
            let requested = try? CodexIntakeContract.date(existing.requestedAt),
            Date().timeIntervalSince(requested) < 15
        {
            throw Failure.devRequestBusy
        }
        let id = UUID()
        let fields: [String: Any] = [
            "version": 1, "id": id.uuidString.lowercased(), "runnerID": runner.runnerID.uuidString.lowercased(),
            "action": action, "scope": scope as Any? ?? NSNull(),
            "requestedAt": CodexIntakeContract.timestamp(Date()),
        ]
        try publishPrivate(try JSONSerialization.data(withJSONObject: fields), name: "dev-request.json")
        defer { removeOwnRequest(id) }
        let started = ContinuousClock.now
        while started.duration(to: .now) < .seconds(45) {
            try Task.checkCancellation()
            guard try heartbeat().runnerID == runner.runnerID else { throw Failure.devServerUnavailable }
            if let result: DevResult = try optionalPrivateValue(
                "dev-result.json", keys: ["version", "id", "status", "error"]), result.id == id
            {
                guard result.version == 1 else { throw Failure.privateStateInvalid }
                if result.status == "ok", result.error == nil { return }
                guard result.status == "error", let error = result.error else { throw Failure.privateStateInvalid }
                switch error {
                case "codex_unavailable": throw Failure.codexUnavailable
                case "mcp_name_conflict": throw Failure.mcpNameConflict
                case "scope_conflict": throw Failure.scopeConflict
                default: throw Failure.commandFailed
                }
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw Failure.timedOut
    }

    private func privateValue<Value: Decodable>(_ name: String, keys: Set<String>) throws -> Value {
        let data = try privateData(name)
        guard let fields = try JSONSerialization.jsonObject(with: data) as? [String: Any], Set(fields.keys) == keys
        else {
            throw Failure.privateStateInvalid
        }
        do { return try JSONDecoder().decode(Value.self, from: data) } catch { throw Failure.privateStateInvalid }
    }

    private func optionalPrivateValue<Value: Decodable>(_ name: String, keys: Set<String>) throws -> Value? {
        do { return try privateValue(name, keys: keys) } catch let error as POSIXError where error.code == .ENOENT {
            return nil
        }
    }

    /// Open the private directory once, then resolve only fixed leaf names relative to its descriptor.
    private func privateDirectory() throws -> Int32 {
        let descriptor = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o7777 == 0o700,
            info.st_mode & S_IFMT == S_IFDIR
        else {
            close(descriptor)
            throw Failure.privateStateInvalid
        }
        return descriptor
    }

    private func privateData(_ name: String) throws -> Data {
        let directory = try privateDirectory()
        defer { close(directory) }
        let descriptor = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o7777 == 0o600,
            info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1, info.st_size <= 16_384
        else { throw Failure.privateStateInvalid }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = read(descriptor, &buffer, buffer.count)
            if count == 0 { return data }
            if count < 0 {
                if errno == EINTR { continue }
                throw Failure.privateStateInvalid
            }
            guard data.count + count <= 16_384 else { throw Failure.privateStateInvalid }
            data.append(contentsOf: buffer.prefix(count))
        }
    }

    private func publishPrivate(_ data: Data, name: String) throws {
        guard data.count <= 16_384 else { throw Failure.privateStateInvalid }
        let directory = try privateDirectory()
        defer { close(directory) }
        let temporary = ".dev-request-\(UUID().uuidString.lowercased()).tmp"
        let descriptor = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw Failure.privateStateInvalid }
        defer {
            close(descriptor)
            unlinkat(directory, temporary, 0)
        }
        try data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { throw Failure.privateStateInvalid }
            var offset = 0
            while offset < data.count {
                let count = write(descriptor, base.advanced(by: offset), data.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw Failure.privateStateInvalid }
                offset += count
            }
        }
        guard fsync(descriptor) == 0, renameat(directory, temporary, directory, name) == 0, fsync(directory) == 0 else {
            throw Failure.privateStateInvalid
        }
    }

    private func removeOwnRequest(_ id: UUID) {
        guard
            let request: DevRequest = try? privateValue(
                "dev-request.json", keys: ["version", "id", "runnerID", "action", "scope", "requestedAt"]),
            request.id == id, let directory = try? privateDirectory()
        else { return }
        defer { close(directory) }
        _ = unlinkat(directory, "dev-request.json", 0)
    }
}
