import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "timer-recording-crash-"));
const executable = join(directory, "recording-probe");
const sources = [
  "Features/Recording/RecordingEvent.swift",
  "Features/Recording/RecordingError.swift",
  "Features/Recording/RecordingSnapshot.swift",
  "Services/Recording/RecordingRepository.swift",
  "Services/Recording/RecordingDatabaseExecutor.swift",
  "Services/Recording/RecordingSQLiteConnection.swift",
  "Services/Recording/SQLiteRecordingRepository.swift",
].map((path) => resolve(root, "TimerMac", path));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}

function succeed(command, args) {
  const result = run(command, args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

try {
  succeed("xcrun", [
    "swiftc", "-parse-as-library", "-swift-version", "6", "-strict-concurrency=complete",
    "-module-cache-path", join(directory, "module-cache"), ...sources,
    resolve(root, "scripts/recording-durability-probe.swift"), "-o", executable,
  ]);
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
