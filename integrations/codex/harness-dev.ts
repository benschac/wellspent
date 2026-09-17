#!/usr/bin/env node
// Development host only: explicit native requests own installation and revocation.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connect,
  connection,
  DEFAULT_ROOT,
  type Execute,
  openHarnessRoot,
  revoke,
  serve,
} from "./harness-helper.ts";
import { canonicalTime, exactKeys, uuid } from "./local-contract.mjs";
import {
  lock,
  optional,
  privateDirectory,
  publish,
  remove,
  sync,
} from "./local-helper.mjs";

export function defaultDevRoot(platform = process.platform, home = homedir()) {
  return platform === "darwin"
    ? join(
        home,
        "Library/Containers/com.benjaminschachter.timer.macos/Data/.config/wellspent/codex-harness",
      )
    : DEFAULT_ROOT;
}
export async function findCodex(
  path = process.env.PATH ?? "",
  home = homedir(),
) {
  const candidates = [
    ...path
      .split(delimiter)
      .filter(isAbsolute)
      .map((part) => join(part, "codex")),
    join(home, ".local/bin/codex"),
  ];
  for (const candidate of candidates) {
    try {
      const absolute = await realpath(candidate);
      await access(absolute, constants.X_OK);
      if ((await stat(absolute)).isFile()) return absolute;
    } catch {
      /* Try the next known executable location. */
    }
  }
  throw new Error("codex_unavailable");
}
const safeCodes = new Set([
  "codex_unavailable",
  "mcp_name_conflict",
  "scope_conflict",
  "invalid_installation",
  "invalid_request",
  "invalid_connection",
  "invalid_private_file",
  "invalid_private_directory",
  "registration_incomplete",
  "storage_busy",
  "helper_unavailable",
]);
export function safeError(error: unknown) {
  return error instanceof Error && safeCodes.has(error.message)
    ? error.message
    : "command_failed";
}
function validRequest(
  // biome-ignore lint/suspicious/noExplicitAny: validated persisted request from the legacy JSON helper.
  value: Record<string, any>,
  runnerID: string,
  now: number,
) {
  return (
    exactKeys(value, [
      "version",
      "id",
      "runnerID",
      "action",
      "scope",
      "requestedAt",
    ]) &&
    value.version === 1 &&
    typeof value.id === "string" &&
    uuid.test(value.id) &&
    value.runnerID === runnerID &&
    ["connect", "revoke"].includes(value.action) &&
    canonicalTime(value.requestedAt) &&
    now - Date.parse(value.requestedAt) >= 0 &&
    now - Date.parse(value.requestedAt) <= 15000 &&
    (value.action === "revoke"
      ? value.scope === null
      : typeof value.scope === "string" &&
        value.scope.length > 0 &&
        Buffer.byteLength(value.scope) <= 200 &&
        ![...value.scope].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ))
  );
}
const delay = (milliseconds: number) =>
  new Promise((done) => setTimeout(done, milliseconds));
type OwnedServer = {
  close(done: () => void): void;
  closeAllConnections?: () => void;
};
type DevRunnerOptions = {
  directory?: string;
  resolveCodex?: () => Promise<string>;
  execute?: Execute;
  startServer?: (root: string) => Promise<OwnedServer>;
  clock?: () => Date;
  intervalMs?: number;
  heartbeatMs?: number;
  notify?: (state: string) => void;
};

async function closeOwned(server: OwnedServer | null) {
  if (!server) return;
  await new Promise<void>((done) => {
    server.close(done);
    server.closeAllConnections?.();
  });
}
export async function startDevRunner({
  directory = defaultDevRoot(),
  resolveCodex = findCodex,
  execute,
  startServer = serve,
  clock = () => new Date(),
  intervalMs = 250,
  heartbeatMs = 1000,
  notify = () => {},
}: DevRunnerOptions = {}) {
  // macOS container prefixes may be symlinks. Canonicalize before applying the
  // same private, outside-checkout harness-root validation as the native helper.
  await privateDirectory(resolve(directory));
  const root = await openHarnessRoot(await realpath(resolve(directory)));
  const guard = join(root, ".dev-runner");
  await privateDirectory(guard);
  const runnerID = randomUUID();
  let stopped = false;
  let ownedServer: OwnedServer | null = null;
  let ownedConnection: string | null = null;
  let heartbeatTask: Promise<void> | undefined;
  let ready: () => void = () => {};
  let failed: (error: unknown) => void = () => {};
  const started = new Promise<void>((done, reject) => {
    ready = done;
    failed = reject;
  });
  const seen = new Set<string>();
  let latestState: string | undefined;
  function report(state: string) {
    if (state !== latestState) {
      latestState = state;
      notify(state);
    }
  }
  async function heartbeat() {
    await publish(
      join(root, "dev-heartbeat.json"),
      { version: 1, runnerID, updatedAt: clock().toISOString() },
      true,
    );
  }
  async function reconcile() {
    if (stopped) return;
    const raw = await optional(join(root, "connection.json"));
    const saved = raw ? await connection(root) : null;
    const registration = await optional(join(root, "registration.json"));
    const available =
      saved &&
      !saved.revoked &&
      registration?.installed === true &&
      registration.connectionID === saved.connectionID;
    const identity = available
      ? JSON.stringify([saved.connectionID, saved.endpoint, saved.key])
      : null;
    if (ownedServer && identity !== ownedConnection) {
      await closeOwned(ownedServer);
      ownedServer = null;
      ownedConnection = null;
    }
    if (available && !ownedServer) {
      if (stopped) return;
      try {
        ownedServer = await startServer(root);
        ownedConnection = identity;
      } catch {
        throw new Error("helper_unavailable");
      }
    }
    report(available ? "serving" : "ready");
  }
  async function processRequest() {
    const request = await optional(join(root, "dev-request.json"));
    if (
      !request ||
      typeof request.id !== "string" ||
      !uuid.test(request.id) ||
      request.runnerID !== runnerID ||
      seen.has(request.id.toLowerCase())
    )
      return;
    if (seen.size >= 10000) throw new Error("storage_busy");
    seen.add(request.id.toLowerCase());
    let error: string | null = null;
    try {
      if (!validRequest(request, runnerID, clock().getTime()))
        throw new Error("invalid_request");
      if (request.action === "connect") {
        const codex = await resolveCodex();
        await connect(
          root,
          { scope: request.scope, codex, node: process.execPath },
          execute,
        );
      } else await revoke(root);
      await reconcile();
    } catch (failure) {
      error = safeError(failure);
    }
    await publish(
      join(root, "dev-result.json"),
      { version: 1, id: request.id, status: error ? "error" : "ok", error },
      true,
    );
  }
  const lifetime = lock(guard, async () => {
    await heartbeat();
    // This task never takes the connection lock, so Connect cannot starve native
    // availability checks while Codex is installing the MCP entry.
    heartbeatTask = (async () => {
      while (!stopped) {
        await delay(heartbeatMs);
        if (!stopped) await heartbeat();
      }
    })();
    heartbeatTask.catch((error) => {
      report(safeError(error));
      stopped = true;
    });
    report("ready");
    ready();
    try {
      while (!stopped) {
        try {
          await processRequest();
          await reconcile();
        } catch (error) {
          report(safeError(error));
        }
        if (!stopped) await delay(intervalMs);
      }
    } finally {
      stopped = true;
      try {
        await heartbeatTask;
      } finally {
        try {
          await closeOwned(ownedServer);
        } finally {
          // Remove only our availability marker. A killed process instead ages
          // out after the native five-second heartbeat freshness window.
          if (
            (await optional(join(root, "dev-heartbeat.json")))?.runnerID ===
            runnerID
          ) {
            await remove(join(root, "dev-heartbeat.json"));
            await sync(root);
          }
        }
      }
    }
  });
  lifetime.catch(failed);
  await started;
  return {
    root,
    runnerID,
    stop: async () => {
      stopped = true;
      await lifetime;
    },
  };
}
export async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 0 &&
    (args.length !== 2 || args[0] !== "--root" || !args[1])
  )
    throw new Error("invalid_request");
  let runner: Awaited<ReturnType<typeof startDevRunner>> | undefined;
  let stopRequested = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      stopRequested = true;
      runner?.stop().catch(() => {
        process.exitCode = 1;
      });
    });
  runner = await startDevRunner({
    directory: args[1] ?? defaultDevRoot(),
    notify: (state) => {
      const messages: Record<string, string> = {
        ready: "AI Harness dev runner ready; use Connect Codex in Wellspent.",
        serving: "AI Harness local helper running.",
      };
      process.stdout.write(
        `${messages[state] ?? `AI Harness dev runner: ${state}.`}\n`,
      );
    },
  });
  if (stopRequested) await runner.stop();
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    const code = safeError(error);
    process.stderr.write(
      code === "storage_busy"
        ? "AI Harness dev runner is already running; use that terminal or stop it before starting another.\n"
        : code === "codex_unavailable"
          ? "Codex CLI was not found. Install Codex or make its executable available on PATH, then retry Connect in Wellspent.\n"
          : `AI Harness dev runner: ${code}.\n`,
    );
    process.exitCode = 1;
  });
