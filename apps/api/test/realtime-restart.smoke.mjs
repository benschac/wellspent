/** Local-only acceptance: a disposable database and real Node API restarts. */
/* global process, console, fetch, AbortSignal, WebSocket, setTimeout, clearTimeout */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createDatabaseConnection } from "@repo/database";
import { sql } from "drizzle-orm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Never consume DATABASE_URL or touch the existing shared timer row.
const localUrl = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const databaseName = `timer_restart_test_${randomUUID().replaceAll("-", "")}`;
assert(/^timer_restart_test_[a-f0-9]{32}$/.test(databaseName));
const testUrl = new URL(localUrl);
testUrl.pathname = `/${databaseName}`;
const admin = createDatabaseConnection(localUrl);
let testDb;
let created = false;
let api;
let apiOutput = "";
const peers = [];
const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const port = portProbe.address().port;
await new Promise((done) => portProbe.close(done));

async function startApi() {
  apiOutput = "";
  api = spawn(process.execPath, ["dist/main.js"], {
    cwd: resolve(root, "apps/api"),
    env: {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
      PORT: String(port),
      GOOGLE_CALENDAR_ENABLED: "false",
      GOOGLE_SHEETS_ENABLED: "false",
      APPLE_LIVE_ACTIVITY_PUSH_ENABLED: "false",
      SUPABASE_URL: "http://127.0.0.1:54421",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [api.stdout, api.stderr]) {
    stream.on("data", (chunk) => {
      apiOutput = (apiOutput + chunk.toString()).slice(-12000);
    });
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(api.exitCode, null, "Test API exited during startup");
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Test API did not start");
}

async function stopApi(signal = "SIGKILL") {
  for (const peer of peers.splice(0)) peer.socket.close();
  if (api && api.exitCode === null && api.signalCode === null) {
    const exited = once(api, "exit");
    api.kill(signal);
    await exited;
  }
}

async function connectPeer() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
  const messages = [];
  const waiters = [];
  function flush() {
    for (const waiter of [...waiters]) {
      const index = messages.findIndex(waiter.predicate);
      if (index >= 0) {
        waiters.splice(waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(messages.splice(index, 1)[0]);
      }
    }
  }
  socket.addEventListener("message", ({ data }) => {
    messages.push(JSON.parse(data));
    flush();
  });
  const next = (predicate) =>
    new Promise((resolveMessage, reject) => {
      const waiter = { predicate, resolve: resolveMessage };
      waiter.timeout = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error("Timed out waiting for WebSocket state"));
      }, 5000);
      waiters.push(waiter);
      flush();
    });
  const peer = {
    socket,
    next,
    messages,
    async command(action, afterRevision) {
      socket.send(JSON.stringify({ event: "timer.command", data: { action } }));
      return (
        await next(
          (message) =>
            message.event === "timer.state" &&
            message.data.revision > afterRevision,
        )
      ).data;
    },
  };
  peers.push(peer);
  peer.initial = (
    await next((message) => message.event === "timer.state")
  ).data;
  return peer;
}

try {
  const build = spawnSync("bun", ["run", "--cwd", "apps/api", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  assert.equal(build.status, 0, "API build failed");
  await admin.database.execute(sql.raw(`CREATE DATABASE "${databaseName}"`));
  created = true;
  testDb = createDatabaseConnection(testUrl.toString());
  await testDb.database.execute(sql.raw('CREATE SCHEMA "app"'));
  const migration = await readFile(
    resolve(
      root,
      "supabase/migrations/20260906224232_persist_realtime_timer.sql",
    ),
    "utf8",
  );
  await testDb.database.execute(sql.raw(migration));

  await startApi();
  let peer = await connectPeer();
  assert.equal(peer.initial.revision, 0);
  assert.equal(peer.initial.elapsedMs, 0);
  assert.equal(peer.initial.isRunning, false);
  const started = await peer.command("start", 0);
  assert.equal(started.revision, 1);
  await stopApi(); // abrupt death: no shutdown hook can save this state
  await startApi();
  peer = await connectPeer();
  assert.deepEqual(
    peer.initial,
    started,
    "Running snapshot changed across restart",
  );
  const paused = await peer.command("pause", started.revision);
  assert.equal(
    paused.elapsedMs,
    Date.parse(paused.updatedAt) - Date.parse(started.updatedAt),
  );
  assert(paused.elapsedMs > 0, "API downtime should count while running");
  await stopApi();
  await startApi();
  peer = await connectPeer();
  assert.deepEqual(
    peer.initial,
    paused,
    "Paused snapshot changed across restart",
  );
  const resumed = await peer.command("start", paused.revision);
  assert.equal(
    resumed.elapsedMs,
    paused.elapsedMs,
    "Paused downtime must not accrue",
  );
  const reset = await peer.command("reset", resumed.revision);
  assert.equal(reset.elapsedMs, 0);
  assert.equal(reset.isRunning, true, "Reset must preserve running status");
  await stopApi();
  await startApi();
  peer = await connectPeer();
  assert.deepEqual(
    peer.initial,
    reset,
    "Reset snapshot changed across restart",
  );
  const stopped = await peer.command("pause", reset.revision);
  const second = await connectPeer();
  const noOpId = randomUUID();
  peer.socket.send(
    JSON.stringify({
      event: "timer.command",
      data: { action: "pause", commandId: noOpId },
    }),
  );
  const noOpAck = await peer.next(
    (message) =>
      message.event === "timer.command.ack" &&
      message.data.commandId === noOpId,
  );
  assert.deepEqual(
    noOpAck.data.state,
    stopped,
    "No-op acknowledgement must preserve the snapshot",
  );
  const resetId = randomUUID();
  peer.socket.send(
    JSON.stringify({
      event: "timer.command",
      data: { action: "reset", commandId: resetId },
    }),
  );
  const resetAck = await peer.next(
    (message) =>
      message.event === "timer.command.ack" &&
      message.data.commandId === resetId,
  );
  assert.equal(resetAck.data.state.revision, stopped.revision + 1);
  const persistedAck = await connectPeer();
  assert.deepEqual(
    persistedAck.initial,
    resetAck.data.state,
    "Acknowledged state must already be persisted",
  );
  // A subsequent pong acts as a same-socket barrier: the other peer receives
  // broadcasts but never another client's direct acknowledgements.
  second.socket.send(
    JSON.stringify({
      event: "realtime.ping",
      data: { sentAt: new Date().toISOString() },
    }),
  );
  await second.next((message) => message.event === "realtime.pong");
  assert.equal(
    second.messages.some((message) => message.event === "timer.command.ack"),
    false,
  );
  // Concurrent state-changing commands must not overwrite each other's revisions.
  for (let index = 0; index < 10; index++) {
    (index % 2 ? peer : second).socket.send(
      JSON.stringify({ event: "timer.command", data: { action: "reset" } }),
    );
  }
  await peer.next(
    (message) =>
      message.event === "timer.state" &&
      message.data.revision === resetAck.data.state.revision + 10,
  );
  const afterConcurrent = await connectPeer();
  assert.equal(
    afterConcurrent.initial.revision,
    resetAck.data.state.revision + 10,
  );
  assert.equal(afterConcurrent.initial.isRunning, false);
  assert.equal(afterConcurrent.initial.elapsedMs, 0);

  // Simulate a rejected write. The gateway must report failure, not broadcast a
  // state that never committed. The trigger exists only in this disposable DB.
  await testDb.database.execute(
    sql.raw(
      `CREATE FUNCTION app.reject_timer_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test write failure'; END $$; CREATE TRIGGER reject_timer_write BEFORE UPDATE ON app.realtime_timer_state FOR EACH ROW EXECUTE FUNCTION app.reject_timer_write();`,
    ),
  );
  peer.socket.send(
    JSON.stringify({
      event: "timer.command",
      data: { action: "start", commandId: "failed-write" },
    }),
  );
  const failure = await peer.next((message) => message.event === "exception");
  assert.equal(failure.data.code, "TIMER_UNAVAILABLE");
  assert.equal(failure.data.commandId, "failed-write");
  assert.equal(
    peer.messages.some(
      (message) =>
        message.event === "timer.command.ack" &&
        message.data.commandId === "failed-write",
    ),
    false,
  );
  const unchanged = await connectPeer();
  assert.deepEqual(unchanged.initial, afterConcurrent.initial);
  console.log(
    "PASS: three abrupt API restarts preserve timer state; correlated acknowledgements confirm committed changes and no-ops only to their sender; failed writes return correlated errors.",
  );
} catch (error) {
  // Test output is bounded and contains no intentional credential logging.
  console.error(apiOutput);
  throw error;
} finally {
  await stopApi();
  await testDb?.close();
  if (created)
    await admin.database.execute(sql.raw(`DROP DATABASE "${databaseName}"`));
  await admin.close();
  console.log(
    "Removed disposable restart-test database; existing Timer data was not changed.",
  );
}
