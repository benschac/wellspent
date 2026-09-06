/**
 * Opt-in end-to-end smoke, never part of the normal unit suite:
 *   node apps/api/test/focus-http.smoke.mjs
 * Requires the Timer local Supabase stack. Creates disposable Auth users, builds
 * and starts only its own API, then deletes those users and stops that process.
 * Never prints credentials or changes the user's shell/harness configuration.
 */
/* global process, fetch, AbortSignal, URL, console */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const port = Number(process.env.TIMER_HTTP_SMOKE_PORT ?? 3102);
assert(
  Number.isInteger(port) && port > 1024 && port < 65536,
  "Invalid smoke port",
);
const origin = `http://127.0.0.1:${port}`;
const env = { ...process.env };
let checks = 0;
let api;
const accounts = [];
const temporary = await mkdtemp(join(tmpdir(), "timer-http-smoke-"));
const log = await open(join(temporary, "api.log"), "a", 0o600);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} failed; inspect its local setup before retrying`,
  );
  return result.stdout;
}

const now = (offset = 0) => new Date(Date.now() + offset * 1000).toISOString();

async function request(
  method,
  path,
  { body, token, expected = 200, absolute = false, apikey } = {},
) {
  const response = await fetch(absolute ? path : `${origin}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(apikey ? { apikey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: unexpected HTTP status`,
  );
  checks += 1;
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

async function stopApi() {
  const process = api;
  if (!process || process.exitCode !== null || process.signalCode !== null)
    return;
  const exited = new Promise((resolveExit) =>
    process.once("exit", resolveExit),
  );
  process.kill("SIGTERM");
  await Promise.race([
    exited,
    delay(10000, undefined, { ref: false }).then(() => {
      if (process.exitCode === null) process.kill("SIGKILL");
    }),
  ]);
  await exited;
}

let status;
try {
  status = JSON.parse(
    run("bunx", ["supabase@2.116.0", "status", "--output", "json"]),
  );
  const db = new URL(status.DB_URL);
  assert.equal(
    status.API_URL,
    "http://127.0.0.1:54421",
    "This smoke only permits local Timer Auth",
  );
  assert.equal(
    db.hostname,
    "127.0.0.1",
    "This smoke only permits local Timer Postgres",
  );
  assert.equal(
    db.port,
    "54422",
    "This smoke only permits the Timer database port",
  );
  assert.equal(db.pathname, "/postgres");
  run("bun", ["run", "--cwd", "apps/api", "build"]);
  const apiEnv = {
    ...env,
    PORT: String(port),
    DATABASE_URL: status.DB_URL,
    SUPABASE_URL: status.API_URL,
    SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    CORS_ORIGIN: "http://localhost:3000",
    GOOGLE_CALENDAR_ENABLED: "false",
    APPLE_LIVE_ACTIVITY_PUSH_ENABLED: "false",
  };
  const startApi = async () => {
    api = spawn("node", ["dist/main.js"], {
      cwd: join(root, "apps/api"),
      env: apiEnv,
      stdio: ["ignore", log.fd, log.fd],
    });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      assert.equal(
        api.exitCode,
        null,
        `API exited during startup; log: ${join(temporary, "api.log")}`,
      );
      try {
        await request("GET", "/focus/sessions", { expected: 401 });
        ready = true;
        break;
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        await delay(200);
      }
    }
    assert(ready, "API did not become ready");
  };
  const signup = async () => {
    const result = await request("POST", `${status.API_URL}/auth/v1/signup`, {
      absolute: true,
      apikey: status.ANON_KEY,
      body: {
        email: `timer-http-${randomUUID()}@example.com`,
        password: `${randomUUID()}A1!`,
      },
    });
    assert.match(result.user.id, /^[0-9a-f-]{36}$/i);
    accounts.push(result.user.id);
    return result.access_token;
  };
  await startApi();
  const a = await signup();
  const b = await signup();
  const owner = (body) => ({
    token: a,
    ...(body === undefined ? {} : { body }),
  });
  await request("GET", "/focus/sessions", { token: "invalid", expected: 401 });
  assert.deepEqual(await request("GET", "/focus/sessions", owner()), []);
  const id = randomUUID();
  const path = `/focus/sessions/${id}`;
  const creation = {
    id,
    commandId: randomUUID(),
    intention: "Validate durable context safely",
    occurredAt: now(-2700),
  };
  const session = await request("POST", "/focus/sessions", owner(creation));
  assert.equal(session.revision, 1);
  assert.equal(session.status, "running");
  assert.equal(
    (await request("POST", "/focus/sessions", owner(creation))).id,
    id,
  );
  await request("POST", "/focus/sessions", {
    ...owner({ ...creation, intention: "Changed" }),
    expected: 409,
  });
  await request("GET", path, { token: b, expected: 404 });
  assert.deepEqual(await request("GET", "/focus/sessions", { token: b }), []);
  assert.equal((await request("GET", "/focus/sessions", owner())).length, 1);
  const note = {
    id: randomUUID(),
    occurredAt: now(-2500),
    summary: "Investigated the failure",
    evidenceUrl: "https://example.com/pull/1",
  };
  assert.equal(
    (await request("POST", `${path}/notes`, owner(note))).events.length,
    1,
  );
  assert.equal(
    (await request("POST", `${path}/notes`, owner(note))).events.length,
    1,
  );
  await request("POST", `${path}/notes`, {
    ...owner({ ...note, summary: "Changed" }),
    expected: 409,
  });
  await request("POST", `${path}/notes`, {
    body: note,
    token: b,
    expected: 404,
  });
  const capture = (await request("POST", `${path}/capture-token`, owner({})))
    .token;
  await request("POST", `${path}/capture-token`, {
    token: b,
    body: {},
    expected: 404,
  });
  await request("GET", path, { token: capture, expected: 401 });
  const pause = {
    commandId: randomUUID(),
    action: "pause",
    expectedRevision: 1,
    occurredAt: now(-1800),
  };
  await request("POST", `${path}/transitions`, {
    body: pause,
    token: capture,
    expected: 401,
  });
  await request("POST", `${path}/transitions`, {
    body: pause,
    token: b,
    expected: 404,
  });
  const paused = await request("POST", `${path}/transitions`, owner(pause));
  assert.equal(paused.status, "paused");
  assert.equal(paused.revision, 2);
  assert.equal(
    (await request("POST", `${path}/transitions`, owner(pause))).revision,
    2,
  );
  await request("POST", `${path}/transitions`, {
    ...owner({ ...pause, action: "finish" }),
    expected: 409,
  });
  await request("POST", `${path}/transitions`, {
    ...owner({ ...pause, commandId: randomUUID() }),
    expected: 409,
  });
  const event = {
    id: randomUUID(),
    source: "codex",
    sourceSessionId: "synthetic-http-test",
    occurredAt: now(-2400),
    kind: "tool_completed",
    summary: "Tool completed: Bash (reported success).",
  };
  await request("POST", `${path}/work-events`, {
    ...owner({ events: [event] }),
    expected: 401,
  });
  for (let retry = 0; retry < 2; retry++)
    assert.deepEqual(
      (
        await request("POST", `${path}/work-events`, {
          token: capture,
          body: { events: [event] },
        })
      ).acceptedEventIds,
      [event.id],
    );
  const conflicted = await request("POST", `${path}/work-events`, {
    token: capture,
    body: { events: [{ ...event, summary: "Changed" }] },
  });
  assert.deepEqual(conflicted.acceptedEventIds, []);
  assert.deepEqual(conflicted.rejectedEvents, [
    { id: event.id, reason: "id_conflict" },
  ]);
  const validBacklog = { ...event, id: randomUUID(), occurredAt: now(-2300) };
  const outsideSession = { ...event, id: randomUUID(), occurredAt: now(-2800) };
  const mixed = await request("POST", `${path}/work-events`, {
    token: capture,
    body: { events: [outsideSession, validBacklog] },
  });
  assert.deepEqual(mixed.acceptedEventIds, [validBacklog.id]);
  assert.deepEqual(mixed.rejectedEvents, [
    { id: outsideSession.id, reason: "outside_session" },
  ]);
  await request("POST", `/focus/sessions/${randomUUID()}/work-events`, {
    token: capture,
    body: { events: [event] },
    expected: 401,
  });
  const resumed = await request(
    "POST",
    `${path}/transitions`,
    owner({
      commandId: randomUUID(),
      action: "resume",
      expectedRevision: 2,
      occurredAt: now(-900),
    }),
  );
  assert.equal(resumed.status, "running");
  assert.equal(resumed.revision, 3);

  const config = join(temporary, "adapter", "config.json");
  const adapter = [join(root, "integrations/codex/timer-capture.mjs")];
  run("node", [...adapter, "configure", "--config", config], {
    input: JSON.stringify({
      apiOrigin: origin,
      sessionId: id,
      shareAssistantSummary: false,
    }),
  });
  const hook = {
    hook_event_name: "PostToolUse",
    session_id: "synthetic-http-adapter",
    tool_use_id: randomUUID(),
    tool_name: "Bash",
    tool_input: { command: "echo private-argument-must-not-leak" },
    tool_response: { exit_code: 0, stdout: "private-output-must-not-leak" },
  };
  const captureEnv = { ...env, TIMER_CAPTURE_TOKEN: capture };
  for (let retry = 0; retry < 2; retry++) {
    assert.equal(
      run("node", [...adapter, "capture", "--config", config], {
        env: captureEnv,
        input: JSON.stringify(hook),
      }).trim(),
      "{}",
    );
    const queue = JSON.parse(
      run("node", [...adapter, "status", "--config", config], {
        env: captureEnv,
      }),
    );
    assert.equal(
      queue.currentSession,
      0,
      "Acknowledged hook replay must not leave a conflicting queued event",
    );
  }
  const evidence = await request("GET", path, owner());
  assert.equal(evidence.events.length, 4);
  assert(!JSON.stringify(evidence).includes("private-argument"));
  assert(!JSON.stringify(evidence).includes("private-output"));
  const finished = await request(
    "POST",
    `${path}/transitions`,
    owner({
      commandId: randomUUID(),
      action: "finish",
      expectedRevision: 3,
      occurredAt: now(),
    }),
  );
  assert.equal(finished.status, "completed");
  assert.equal(finished.revision, 4);
  assert(
    finished.elapsedMs >= 1800000 && finished.elapsedMs < 1815000,
    "Pause time must be excluded",
  );
  // A hook arriving after the focus session ended is retained locally as a
  // rejected original; it must not poison the active delivery queue.
  await delay(10);
  run("node", [...adapter, "capture", "--config", config], {
    env: captureEnv,
    input: JSON.stringify({ ...hook, tool_use_id: randomUUID() }),
  });
  const rejectedQueue = JSON.parse(
    run("node", [...adapter, "status", "--config", config], {
      env: captureEnv,
    }),
  );
  assert.equal(rejectedQueue.currentSession, 0);
  assert.equal(rejectedQueue.currentSessionRejected, 1);
  assert.equal(
    rejectedQueue.rejectedByReason.currentSession.outside_session,
    1,
  );
  const recap = {
    text: "Investigated the failure and validated a fix.",
    expectedRevision: 0,
  };
  assert.equal(
    (await request("PATCH", `${path}/recap`, owner(recap))).session
      .recapRevision,
    1,
  );
  assert.equal(
    (await request("PATCH", `${path}/recap`, owner(recap))).session
      .recapRevision,
    1,
  );
  await request("PATCH", `${path}/recap`, {
    ...owner({ text: "Concurrent overwrite", expectedRevision: 0 }),
    expected: 409,
  });
  await request("PATCH", `${path}/recap`, {
    token: b,
    body: { text: "No", expectedRevision: 1 },
    expected: 404,
  });
  await request("DELETE", `${path}/capture-token`, owner({}));
  await request("POST", `${path}/work-events`, {
    token: capture,
    body: { events: [event] },
    expected: 401,
  });
  await stopApi();
  await startApi();
  const saved = await request("GET", path, owner());
  assert.equal(saved.session.status, "completed");
  assert.equal(saved.session.recapRevision, 1);
  assert.equal(saved.events.length, 4);
  assert(saved.segments.length >= 2);
  // A valid maximum-size multilingual batch must fit the actual HTTP parser,
  // not merely the per-field Zod limits (Express defaults to only 100 KiB).
  const largeId = randomUUID();
  await request(
    "POST",
    "/focus/sessions",
    owner({
      id: largeId,
      commandId: randomUUID(),
      intention: "Multilingual capture fixture",
      occurredAt: now(-60),
    }),
  );
  const largePath = `/focus/sessions/${largeId}`;
  const largeToken = (
    await request("POST", `${largePath}/capture-token`, owner({}))
  ).token;
  const largeEvents = Array.from({ length: 50 }, () => ({
    ...event,
    id: randomUUID(),
    occurredAt: now(),
    summary: "工".repeat(2000),
  }));
  const largeResult = await request("POST", `${largePath}/work-events`, {
    token: largeToken,
    body: { events: largeEvents },
  });
  assert.equal(largeResult.acceptedEventIds.length, 50);
  assert.equal(largeResult.rejectedEvents.length, 0);
  await request("POST", `${largePath}/work-events`, {
    token: largeToken,
    body: { events: [...largeEvents, { ...event, id: randomUUID() }] },
    expected: 400,
  });
  console.log(
    `PASS: ${checks} HTTP checks: real local Auth, ownership, retries, capture scope/revocation, adapter delivery/replay/privacy, and persistence across API restart.`,
  );
} finally {
  await stopApi();
  // IDs come only from this run's successful local Auth responses. Cascades remove
  // profiles, focus sessions, transitions, capture credentials and work events.
  for (const id of accounts)
    run("psql", [
      status.DB_URL,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `delete from auth.users where id = '${id}';`,
    ]);
  await log.close();
  await rm(temporary, { recursive: true, force: true });
  console.log(
    "Disposable accounts cleaned; isolated API stopped; local Supabase left running.",
  );
}
