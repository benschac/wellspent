import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { defaultDevRoot, safeError, startDevRunner } from "./harness-dev.mjs";
import { connect, connection, openHarnessRoot } from "./harness-helper.mjs";
import { optional, publish, read } from "./local-helper.mjs";

const delay = (milliseconds) =>
  new Promise((done) => setTimeout(done, milliseconds));
async function eventually(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await check();
    if (value) return value;
    await delay(10);
  }
  assert.fail("Expected dev-runner checkpoint was not reached");
}
async function fixture(t) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "wellspent-harness-dev-test-"),
  );
  await chmod(root, 0o700);
  await openHarnessRoot(root);
  const calls = [];
  const servers = [];
  const states = [];
  let registrations = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args[1] === "list") return { stdout: JSON.stringify(registrations) };
    registrations = [
      {
        name: "wellspent-local",
        enabled: true,
        transport: {
          type: "stdio",
          command: args[4],
          args: args.slice(5),
          env: null,
          env_vars: [],
          cwd: null,
        },
      },
    ];
    return { stdout: "installed" };
  };
  const options = {
    directory: root,
    execute,
    resolveCodex: async () => "/fixture/codex",
    intervalMs: 10,
    heartbeatMs: 20,
    notify: (state) => states.push(state),
    startServer: async () => {
      const server = {
        closed: false,
        close(done) {
          this.closed = true;
          done();
        },
        closeAllConnections() {},
      };
      servers.push(server);
      return server;
    },
  };
  const runners = [];
  const start = async (overrides = {}) => {
    const runner = await startDevRunner({ ...options, ...overrides });
    runners.push(runner);
    return runner;
  };
  const request = async (runner, action = "connect", overrides = {}) => {
    const value = {
      version: 1,
      id: randomUUID(),
      runnerID: runner.runnerID,
      action,
      scope: action === "connect" ? "fixture-local" : null,
      requestedAt: new Date().toISOString(),
      ...overrides,
    };
    await publish(join(root, "dev-request.json"), value, true);
    return value;
  };
  const result = (id) =>
    eventually(async () => {
      const value = await optional(join(root, "dev-result.json"));
      return value?.id === id ? value : null;
    });
  t.after(async () => {
    await Promise.allSettled(runners.map((runner) => runner.stop()));
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    options,
    calls,
    servers,
    states,
    execute,
    start,
    request,
    result,
  };
}
test("development root targets native macOS container and startup publishes private heartbeat without installing", async (t) => {
  assert.equal(
    defaultDevRoot("darwin", "/fixture/user"),
    "/fixture/user/Library/Containers/com.benjaminschachter.timer.macos/Data/.config/wellspent/codex-harness",
  );
  const f = await fixture(t);
  const runner = await f.start();
  const heartbeat = await read(join(f.root, "dev-heartbeat.json"));
  assert.equal(heartbeat.version, 1);
  assert.equal(heartbeat.runnerID, runner.runnerID);
  assert.equal(
    (await stat(join(f.root, "dev-heartbeat.json"))).mode & 0o077,
    0,
  );
  assert.equal((await stat(f.root)).mode & 0o077, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.servers.length, 0);
  assert.equal(await optional(join(f.root, "connection.json")), null);
});
test("explicit request connects once with Node on PATH, revokes owned server, and reconnect rotates identity", async (t) => {
  const f = await fixture(t);
  const runner = await f.start();
  const first = await f.request(runner);
  assert.deepEqual(await f.result(first.id), {
    version: 1,
    id: first.id,
    status: "ok",
    error: null,
  });
  const saved = await connection(f.root);
  assert.equal(f.servers.length, 1);
  const add = f.calls.find((call) => call.args[1] === "add");
  assert.ok(add);
  assert.equal(add.args[4], process.execPath);
  assert.equal(
    add.options.env.PATH.split(delimiter)[0],
    dirname(process.execPath),
  );
  assert.equal(JSON.stringify(add.args).includes(saved.key), false);
  await delay(70);
  assert.equal(f.calls.length, 2);
  const revoke = await f.request(runner, "revoke");
  assert.equal((await f.result(revoke.id)).status, "ok");
  assert.equal((await connection(f.root)).revoked, true);
  assert.equal(f.servers[0].closed, true);
  const next = await f.request(runner);
  assert.equal((await f.result(next.id)).status, "ok");
  assert.notEqual((await connection(f.root)).connectionID, saved.connectionID);
  assert.equal(f.servers.length, 2);
  await runner.stop();
  assert.equal(f.servers[1].closed, true);
});
test("runner restart serves installed connection without repeating registration or old requests", async (t) => {
  const f = await fixture(t);
  const first = await f.start();
  const request = await f.request(first);
  assert.equal((await f.result(request.id)).status, "ok");
  await first.stop();
  assert.equal(await optional(join(f.root, "dev-heartbeat.json")), null);
  const count = f.calls.length;
  const second = await f.start();
  assert.notEqual(second.runnerID, first.runnerID);
  await eventually(() => f.servers.length === 2);
  await delay(50);
  assert.equal(f.calls.length, count);
  assert.equal(
    (await read(join(f.root, "dev-heartbeat.json"))).runnerID,
    second.runnerID,
  );
});
test("heartbeat continues while an explicit connection operation is waiting", async (t) => {
  const f = await fixture(t);
  let release;
  const waiting = new Promise((done) => {
    release = done;
  });
  let entered = false;
  const runner = await f.start({
    execute: async (...args) => {
      entered = true;
      await waiting;
      return f.execute(...args);
    },
  });
  const request = await f.request(runner);
  await eventually(() => entered);
  const before = await read(join(f.root, "dev-heartbeat.json"));
  await eventually(
    async () =>
      (await read(join(f.root, "dev-heartbeat.json"))).updatedAt !==
      before.updatedAt,
  );
  assert.equal(await optional(join(f.root, "dev-result.json")), null);
  release();
  assert.equal((await f.result(request.id)).status, "ok");
});
test("request validation rejects stale, future, extra fields and wrong scope while other runner requests are ignored", async (t) => {
  const f = await fixture(t);
  const runner = await f.start();
  for (const overrides of [
    { requestedAt: new Date(Date.now() - 16000).toISOString() },
    { requestedAt: new Date(Date.now() + 16000).toISOString() },
    { extra: "unsupported" },
    { scope: null },
  ]) {
    const value = await f.request(runner, "connect", overrides);
    assert.equal((await f.result(value.id)).error, "invalid_request");
  }
  const wrongRunner = await f.request(runner, "connect", {
    runnerID: randomUUID(),
  });
  await delay(60);
  assert.notEqual(
    (await read(join(f.root, "dev-result.json"))).id,
    wrongRunner.id,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.servers.length, 0);
});
test("safe request failures do not expose child output and a later new request repairs installation", async (t) => {
  const f = await fixture(t);
  let reject = true;
  const runner = await f.start({
    execute: async (...args) => {
      if (reject) throw new Error("private stderr key SECRET_FIXTURE");
      return f.execute(...args);
    },
  });
  const failed = await f.request(runner);
  const value = await f.result(failed.id);
  assert.equal(value.error, "command_failed");
  assert.equal(JSON.stringify(value).includes("SECRET"), false);
  reject = false;
  const retry = await f.request(runner);
  assert.equal((await f.result(retry.id)).status, "ok");
  assert.equal(safeError(new Error("codex_unavailable")), "codex_unavailable");
});
test("live runner ownership prevents a second runner; stopped ownership can be acquired", async (t) => {
  const f = await fixture(t);
  const first = await f.start();
  await assert.rejects(startDevRunner(f.options), /storage_busy/);
  assert.equal(
    (await read(join(f.root, "dev-heartbeat.json"))).runnerID,
    first.runnerID,
  );
  await first.stop();
  const second = await f.start();
  assert.notEqual(second.runnerID, first.runnerID);
});
test("startup ignores an incompletely registered connection and never launches an unrelated server", async (t) => {
  const f = await fixture(t);
  const saved = await connect(
    f.root,
    { scope: "fixture-local", codex: "/fixture/codex", node: process.execPath },
    f.execute,
  );
  const registration = await read(join(f.root, "registration.json"));
  await publish(
    join(f.root, "registration.json"),
    { ...registration, installed: false },
    true,
  );
  f.calls.length = 0;
  await f.start();
  await delay(50);
  assert.equal(f.calls.length, 0);
  assert.equal(f.servers.length, 0);
  assert.equal((await connection(f.root)).connectionID, saved.connectionID);
});
test("heartbeat storage failure still closes the owned listener", async (t) => {
  const f = await fixture(t);
  const runner = await f.start();
  const request = await f.request(runner);
  assert.equal((await f.result(request.id)).status, "ok");
  const heartbeatPath = join(f.root, "dev-heartbeat.json");
  await rm(heartbeatPath);
  await mkdir(heartbeatPath, { mode: 0o700 });
  await eventually(() => f.servers[0].closed);
  await assert.rejects(runner.stop());
});
test("shutdown during Connect does not start a new helper after the CLI finishes", async (t) => {
  const f = await fixture(t);
  let release;
  const gate = new Promise((done) => {
    release = done;
  });
  let entered = false;
  const runner = await f.start({
    execute: async (...args) => {
      entered = true;
      await gate;
      return f.execute(...args);
    },
  });
  const request = await f.request(runner);
  await eventually(() => entered);
  const stopped = runner.stop();
  release();
  await stopped;
  assert.equal(f.servers.length, 0);
  assert.equal((await f.result(request.id)).status, "ok");
  assert.equal(await optional(join(f.root, "dev-heartbeat.json")), null);
});
test("actual CLI starts privately without registration and SIGTERM removes its heartbeat", async (t) => {
  const f = await fixture(t);
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./harness-dev.mjs", import.meta.url)),
      "--root",
      f.root,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise((done) => child.once("close", done));
  await eventually(() => optional(join(f.root, "dev-heartbeat.json")));
  assert.equal(await optional(join(f.root, "connection.json")), null);
  assert.equal(await optional(join(f.root, "registration.json")), null);
  child.kill("SIGTERM");
  assert.equal(await exit, 0);
  assert.equal(await optional(join(f.root, "dev-heartbeat.json")), null);
  assert.match(stdout, /AI Harness dev runner ready/);
  assert.equal(stderr, "");
});
