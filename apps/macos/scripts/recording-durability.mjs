import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = realpathSync(
  mkdtempSync(join(tmpdir(), "timer-recording-crash-")),
);
const packageDirectory = join(directory, "package");
const sourceDirectory = join(
  packageDirectory,
  "Sources",
  "RecordingDurabilityProbe",
);
const sources = [
  "Features/Recording/RecordingEvent.swift",
  "Features/Recording/RecordingError.swift",
  "Features/Recording/RecordingSnapshot.swift",
  "Services/Recording/RecordingRepository.swift",
  "Services/Recording/RecordingDatabaseRecords.swift",
  "Services/Recording/SQLiteRecordingRepository.swift",
  "Services/Recording/CodexIntakeContract.swift",
  "Services/Recording/LocalCodexTransport.swift",
].map((path) => resolve(root, "TimerMac", path));

function run(command, args, timeout = 60_000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function succeed(command, args, timeout) {
  const result = run(command, args, timeout);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result;
}

async function codexDurability(executable) {
  const helper = resolve(root, "../../integrations/codex/local-helper.mjs");
  for (const phase of ["before", "during", "after", "beforeACK", "afterACK"]) {
    const database = join(directory, `codex-${phase}.sqlite`);
    const outbox = join(directory, `outbox-${phase}`);
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    assert(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}`;
    await new Promise((done) => reservation.close(done));
    const bundle = succeed(executable, [
      "codex-seed",
      database,
      endpoint,
    ]).stdout.trim();
    const helperCommand = (command, input) => {
      const result = spawnSync(
        process.execPath,
        [helper, "--root", outbox, command],
        {
          input,
          encoding: "utf8",
          timeout: 15000,
        },
      );
      assert.equal(
        result.status,
        0,
        `Synthetic helper ${command} failed: ${result.stderr}`,
      );
      return JSON.parse(result.stdout);
    };
    helperCommand("setup", bundle);
    helperCommand(
      "capture",
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "synthetic-thread",
        turn_id: "synthetic-turn",
        tool_use_id: "synthetic-tool",
        tool_name: "Bash",
        tool_input: { command: "true" },
        tool_response: { exit_code: 0 },
      }),
    );
    assert.equal(helperCommand("status").pending, 1);
    succeed(executable, ["codex-close", database, "none"]);
    let server;
    const start = async () => {
      server = spawn(process.execPath, [helper, "--root", outbox, "serve"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const ready = once(server.stdout, "data");
      const exited = once(server, "exit").then(() => {
        throw Error("Synthetic helper exited before listening");
      });
      await Promise.race([ready, exited]);
    };
    const stop = async () => {
      if (!server || server.exitCode !== null || server.signalCode !== null)
        return;
      const exited = once(server, "exit");
      server.kill("SIGKILL");
      await exited;
    };
    try {
      await start();
      const crashed = run(executable, ["codex-crash", database, phase]);
      assert.equal(
        crashed.signal,
        "SIGKILL",
        crashed.stderr || "Native Codex checkpoint was not reached",
      );
      await stop();
      assert.equal(
        helperCommand("status").pending,
        phase === "afterACK" ? 0 : 1,
      );
      await start();
      succeed(executable, [
        phase === "afterACK" ? "codex-verify-acked" : "codex-recover",
        database,
        phase,
      ]);
      assert.equal(helperCommand("status").pending, 0);
      console.log(
        `PASS local Codex native/helper SIGKILL and authenticated HTTP recovery: ${phase}`,
      );
    } finally {
      await stop();
    }
  }
}

try {
  mkdirSync(sourceDirectory, { recursive: true });
  // Symlinks compile the production implementation, never a separately maintained probe copy.
  for (const source of [
    ...sources,
    resolve(root, "scripts/recording-durability-probe.swift"),
  ]) {
    symlinkSync(source, join(sourceDirectory, basename(source)));
  }
  writeFileSync(
    join(packageDirectory, "Package.swift"),
    `// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "RecordingDurabilityProbe",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/pointfreeco/sqlite-data", exact: "1.11.0"),
        .package(url: "https://github.com/pointfreeco/swift-structured-queries", exact: "0.36.0")
    ],
    targets: [
        .executableTarget(
            name: "RecordingDurabilityProbe",
            dependencies: [.product(name: "SQLiteData", package: "sqlite-data")])
    ],
    swiftLanguageModes: [.v6]
)
`,
  );
  // The crash probe must exercise the same resolved dependency versions as the app.
  copyFileSync(
    resolve(
      root,
      "TimerMac.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
    ),
    join(packageDirectory, "Package.resolved"),
  );
  console.log("Building production recording crash probe with SQLiteData…");
  succeed(
    "xcrun",
    [
      "swift",
      "build",
      "--package-path",
      packageDirectory,
      "--scratch-path",
      resolve(root, ".derivedData/recording-durability"),
      "--force-resolved-versions",
      "--product",
      "RecordingDurabilityProbe",
    ],
    600_000,
  );
  const binaryDirectory = succeed("xcrun", [
    "swift",
    "build",
    "--package-path",
    packageDirectory,
    "--scratch-path",
    resolve(root, ".derivedData/recording-durability"),
    "--show-bin-path",
  ]).stdout.trim();
  const executable = join(binaryDirectory, "RecordingDurabilityProbe");
  for (const phase of ["before", "during", "after", "migration"]) {
    const database = join(directory, `${phase}.sqlite`);
    if (phase !== "migration") succeed(executable, ["seed", database, "none"]);
    const crashed = run(executable, ["crash", database, phase]);
    assert.equal(
      crashed.signal,
      "SIGKILL",
      crashed.stderr || "Crash checkpoint was not reached",
    );
    succeed(executable, ["verify", database, phase]);
    console.log(`PASS forced termination: ${phase}`);
  }
  if (process.argv.includes("--codex")) await codexDurability(executable);
} finally {
  // Remove this runner's temporary package and synthetic stores; reusable build output
  // remains in the app's ignored .derivedData/recording-durability directory.
  rmSync(directory, { recursive: true, force: true });
}
