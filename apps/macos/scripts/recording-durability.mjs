import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "timer-recording-crash-"));
const packageDirectory = join(directory, "package");
const sourceDirectory = join(packageDirectory, "Sources", "RecordingDurabilityProbe");
const sources = [
  "Features/Recording/RecordingEvent.swift",
  "Features/Recording/RecordingError.swift",
  "Features/Recording/RecordingSnapshot.swift",
  "Services/Recording/RecordingRepository.swift",
  "Services/Recording/RecordingDatabaseRecords.swift",
  "Services/Recording/SQLiteRecordingRepository.swift",
].map((path) => resolve(root, "TimerMac", path));

function run(command, args, timeout = 60_000) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function succeed(command, args, timeout) {
  const result = run(command, args, timeout);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result;
}

try {
  mkdirSync(sourceDirectory, { recursive: true });
  // Symlinks compile the production implementation, never a separately maintained probe copy.
  for (const source of [...sources, resolve(root, "scripts/recording-durability-probe.swift")]) {
    symlinkSync(source, join(sourceDirectory, basename(source)));
  }
  writeFileSync(join(packageDirectory, "Package.swift"), `// swift-tools-version: 6.1
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
`);
  // The crash probe must exercise the same resolved dependency versions as the app.
  copyFileSync(
    resolve(root, "TimerMac.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"),
    join(packageDirectory, "Package.resolved"),
  );
  console.log("Building production recording crash probe with SQLiteData…");
  succeed("xcrun", [
    "swift", "build", "--package-path", packageDirectory, "--force-resolved-versions",
    "--product", "RecordingDurabilityProbe",
  ], 600_000);
  const binaryDirectory = succeed("xcrun", [
    "swift", "build", "--package-path", packageDirectory, "--show-bin-path",
  ]).stdout.trim();
  const executable = join(binaryDirectory, "RecordingDurabilityProbe");
  for (const phase of ["before", "during", "after", "migration"]) {
    const database = join(directory, `${phase}.sqlite`);
    if (phase !== "migration") succeed(executable, ["seed", database, "none"]);
    const crashed = run(executable, ["crash", database, phase]);
    assert.equal(crashed.signal, "SIGKILL", crashed.stderr || "Crash checkpoint was not reached");
    succeed(executable, ["verify", database, phase]);
    console.log(`PASS forced termination: ${phase}`);
  }
} finally {
  // This unique directory contains only this runner's compiled helper and disposable stores.
  rmSync(directory, { recursive: true, force: true });
}
