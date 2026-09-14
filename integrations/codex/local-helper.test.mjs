import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bodyDigest,
  decode,
  metadataFromHook,
  sign,
  validateBundle,
} from "./local-contract.mjs";
import {
  capture,
  cleanup,
  dispatch,
  identity,
  openLocalRoot,
  retire,
  serve,
  setup,
  status,
} from "./local-helper.mjs";

const key = Buffer.alloc(32, 42);
const now = new Date("2027-01-15T08:00:05.000Z");
const fixture = JSON.parse(
  await readFile(
    new URL("../../docs/design/probes/c3a/fixture.json", import.meta.url),
  ),
);
const input = {
  hook_event_name: "PostToolUse",
  session_id: "thread_fixture",
  turn_id: "turn_fixture",
  tool_use_id: "tool_fixture",
  tool_name: "Bash",
  tool_response: { exit_code: 0 },
};
function bundle(port = 43871) {
  return {
    version: 1,
    endpoint: `http://127.0.0.1:${port}`,
    key: key.toString("base64"),
    binding: {
      ...fixture.binding,
      issuedAt: "2027-01-15T08:00:00.000Z",
      acceptUntil: "2027-01-22T08:00:00.000Z",
    },
  };
}
async function root(t) {
  const path = await mkdtemp(
    join(await realpath(tmpdir()), "wellspent-local-test-"),
  );
  await chmod(path, 0o700);
  t.after(() => rm(path, { recursive: true, force: true }));
  return openLocalRoot(path);
}
const poll = (bindingID = fixture.binding.bindingID, date = now) =>
  sign(
    {
      version: 1,
      bindingID,
      nonce: randomUUID(),
      issuedAt: date.toISOString(),
    },
    key,
    "poll",
  );
function ack(packet) {
  return sign(
    {
      eventID: decode(packet).value.eventID,
      bodyDigest: bodyDigest(packet),
      nativeReceivedAt: now.toISOString(),
    },
    key,
    "ack",
  );
}
const cli = fileURLToPath(new URL("./local-helper.mjs", import.meta.url));
function runCLI(path, command, inputValue) {
  return spawnSync(process.execPath, [cli, "--root", path, command], {
    input: inputValue === undefined ? undefined : JSON.stringify(inputValue),
    encoding: "utf8",
  });
}

test("golden vector, privacy allowlist, stable identity and self suppression", () => {
  assert.deepEqual(
    sign(metadataFromHook(input, fixture.binding, now), key),
    fixture.packet,
  );
  const output = metadataFromHook(
    {
      ...input,
      cwd: "PRIVATE",
      transcript_path: "PRIVATE",
      last_assistant_message: "PRIVATE",
      tool_input: { command: "echo PRIVATE" },
      tool_response: { output: "PRIVATE", exit_code: 0 },
      occurredAt: "PRIVATE",
    },
    fixture.binding,
    now,
  );
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE/);
  assert.equal(output.occurredAt, null);
  assert.equal(
    metadataFromHook(
      { ...input, tool_input: { code: "node local-helper.mjs capture" } },
      fixture.binding,
      now,
    ).reason,
    "self_capture",
  );
  assert.equal(
    metadataFromHook(
      { ...input, tool_input: { command: "node timer-capture.mjs capture" } },
      fixture.binding,
      now,
    ).reason,
    "self_capture",
  );
  assert.equal(
    metadataFromHook({ ...input, tool_use_id: undefined }, fixture.binding, now)
      .reason,
    "missing_identity",
  );
  assert.equal(
    metadataFromHook(
      { ...input, hook_event_name: "Stop" },
      fixture.binding,
      now,
    ).reportedResult,
    "unknown",
  );
});

test("durable private stdin setup preserves sender and rejects conflicting re-pair/remote endpoints", async (t) => {
  const path = await root(t);
  assert.equal(runCLI(path, "setup", bundle()).status, 0);
  assert.deepEqual(await identity(path), {
    senderID: fixture.binding.senderID,
  });
  assert.equal(
    (await stat(join(path, "bindings", `${fixture.binding.bindingID}.json`)))
      .mode & 0o777,
    0o600,
  );
  await assert.rejects(
    setup(path, {
      ...bundle(),
      binding: { ...bundle().binding, senderID: "other" },
    }),
    /sender_mismatch/,
  );
  await assert.rejects(
    setup(path, { ...bundle(), key: Buffer.alloc(32, 1).toString("base64") }),
    /binding_conflict/,
  );
  for (const endpoint of [
    "http://localhost:43871",
    "https://127.0.0.1:43871",
    "http://127.0.0.1:43871/",
    "http://127.0.0.1:80",
    "http://127.0.0.2:43871",
  ])
    assert.throws(() => validateBundle({ ...bundle(), endpoint }));
  const next = {
    ...bundle(),
    binding: {
      ...bundle().binding,
      bindingID: randomUUID(),
      intervalID: randomUUID(),
      issuedAt: "2027-01-15T08:00:04.000Z",
      acceptUntil: "2027-01-22T08:00:04.000Z",
    },
  };
  await setup(path, next);
  await capture(path, input, now);
  assert.equal(
    decode(
      (await dispatch(path, "/v1/poll", poll(next.binding.bindingID), now))
        .packet,
    ).value.intervalID,
    next.binding.intervalID,
  );
});

test("first immutable packet survives reopen and ACK lost/retried, receipt has ID only", async (t) => {
  const path = await root(t);
  await setup(path, bundle());
  await capture(path, input, now);
  const first = (await dispatch(path, "/v1/poll", poll(), now)).packet;
  await capture(
    await openLocalRoot(path),
    input,
    new Date(now.getTime() + 1000),
  );
  assert.deepEqual(
    (await dispatch(path, "/v1/poll", poll(), now)).packet,
    first,
  );
  const receipt = ack(first);
  await assert.rejects(
    dispatch(path, "/v1/ack", sign(decode(receipt).value, key, "event"), now),
    /untrustedSender/,
  );
  await assert.rejects(
    dispatch(
      path,
      "/v1/ack",
      sign(
        { ...decode(receipt).value, bodyDigest: "a".repeat(64) },
        key,
        "ack",
      ),
      now,
    ),
    /mismatched_ack/,
  );
  assert.equal((await status(path)).pending, 1);
  await dispatch(path, "/v1/ack", receipt, now);
  await dispatch(await openLocalRoot(path), "/v1/ack", receipt, now);
  const stored = JSON.parse(
    await readFile(
      join(path, "receipts", `${decode(first).value.eventID}.json`),
    ),
  );
  assert.deepEqual(stored, { id: decode(first).value.eventID });
  assert.equal((await capture(path, input, now)).duplicate, true);
  assert.equal((await status(path)).pending, 0);
});

test("fresh authenticated durable poll/status/rejection controls and bounded content-free exclusion", async (t) => {
  const path = await root(t);
  await setup(path, bundle());
  await capture(
    path,
    { ...input, session_id: "other", last_assistant_message: "SECRET" },
    now,
  );
  await capture(path, input, now);
  const request = poll();
  const first = (await dispatch(path, "/v1/poll", request, now)).packet;
  await assert.rejects(
    dispatch(await openLocalRoot(path), "/v1/poll", request, now),
    /replayed_request/,
  );
  await assert.rejects(
    dispatch(
      path,
      "/v1/poll",
      poll(undefined, new Date(now.getTime() - 31000)),
      now,
    ),
    /stale_request/,
  );
  const value = {
    version: 1,
    bindingID: fixture.binding.bindingID,
    eventID: decode(first).value.eventID,
    bodyDigest: bodyDigest(first),
    reason: "outsideInterval",
    nonce: randomUUID(),
    issuedAt: now.toISOString(),
  };
  await assert.rejects(
    dispatch(
      path,
      "/v1/reject",
      sign({ ...value, reason: "awaitingIntervalEnd" }, key, "reject"),
      now,
    ),
    /invalidPacket/,
  );
  await dispatch(
    path,
    "/v1/reject",
    sign({ ...value, nonce: randomUUID() }, key, "reject"),
    now,
  );
  assert.deepEqual(await status(path), {
    pending: 0,
    quarantined: 1,
    unassociated: 1,
    reasons: { unassociated: 1, outsideInterval: 1 },
  });
  assert.doesNotMatch(
    await readFile(join(path, "counts.json"), "utf8"),
    /SECRET|other/,
  );
  await cleanup(path, "quarantine");
  assert.equal((await status(path)).quarantined, 0);
});

test("unpublished files ignored, receipt-before-delete crash recovered, bad permissions fail closed", async (t) => {
  const path = await root(t);
  await setup(path, bundle());
  await capture(path, input, now);
  const packet = (await dispatch(path, "/v1/poll", poll(), now)).packet;
  const eventID = decode(packet).value.eventID;
  await writeFile(join(path, "pending", `.${randomUUID()}.tmp`), "SECRET", {
    mode: 0o600,
  });
  await writeFile(
    join(path, "receipts", `${eventID}.json`),
    JSON.stringify({ id: eventID }),
    { mode: 0o600 },
  );
  assert.equal((await dispatch(path, "/v1/poll", poll(), now)).packet, null);
  assert.equal((await status(path)).pending, 0);
  await chmod(
    join(path, "bindings", `${fixture.binding.bindingID}.json`),
    0o644,
  );
  await assert.rejects(capture(path, input, now), /invalid_private_file/);
});

test("capture hook always returns empty JSON and fail-open without leaking input", async (t) => {
  const path = await root(t);
  const result = runCLI(path, "capture", {
    ...input,
    last_assistant_message: "SECRET",
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET/);
  const diagnosticPath = join(path, "capture-diagnostic.json");
  const unassociated = JSON.parse(await readFile(diagnosticPath, "utf8"));
  assert.equal(unassociated.stage, "complete");
  assert.equal(unassociated.code, "unassociated");
  assert.equal(unassociated.kind, "PostToolUse");
  assert.equal(unassociated.threadID, input.session_id);
  assert.equal(unassociated.invocationID, input.tool_use_id);
  assert.equal((await stat(diagnosticPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(unassociated), /SECRET/);
  const malformed = spawnSync(
    process.execPath,
    [cli, "--root", path, "capture"],
    { input: "SECRET NOT JSON", encoding: "utf8" },
  );
  assert.equal(malformed.status, 0);
  assert.deepEqual(JSON.parse(malformed.stdout), {});
  assert.equal(malformed.stderr, "wellspent_capture:invalid_json_input\n");
  const failure = JSON.parse(await readFile(diagnosticPath, "utf8"));
  assert.equal(failure.stage, "stdin");
  assert.equal(failure.code, "invalid_json_input");
  assert.notEqual(failure.attemptID, unassociated.attemptID);
  assert.equal(Object.hasOwn(failure, "threadID"), false);
  assert.doesNotMatch(JSON.stringify(failure), /SECRET/);
  // Diagnostic codes must not enter the strict native status reason contract.
  assert.deepEqual(await status(path), {
    pending: 0,
    quarantined: 0,
    unassociated: 1,
    reasons: { unassociated: 1 },
  });
});

test("CLI checkpoints distinguish stdin delivery from durable enqueue and duplicate", async (t) => {
  const path = await root(t);
  const b = bundle();
  const issuedAt = Date.now() - 5000;
  b.binding.issuedAt = new Date(issuedAt).toISOString();
  b.binding.acceptUntil = new Date(issuedAt + 7 * 86400000).toISOString();
  await setup(path, b);
  const child = spawn(process.execPath, [cli, "--root", path, "capture"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  const diagnosticPath = join(path, "capture-diagnostic.json");
  let waiting;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      waiting = JSON.parse(await readFile(diagnosticPath, "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(waiting?.stage, "stdin");
  assert.equal(waiting?.code, "waiting_for_input");
  child.stdin.end(JSON.stringify(input));
  assert.equal(await completion, 0);
  const queued = JSON.parse(await readFile(diagnosticPath, "utf8"));
  assert.equal(queued.stage, "complete");
  assert.equal(queued.code, "queued");
  assert.equal(typeof queued.eventID, "string");
  const pending = JSON.parse(
    await readFile(join(path, "pending", `${queued.eventID}.json`), "utf8"),
  );
  assert.equal(decode(pending).value.invocationID, input.tool_use_id);
  assert.equal(runCLI(path, "capture", input).status, 0);
  assert.equal(
    JSON.parse(await readFile(diagnosticPath, "utf8")).code,
    "duplicate",
  );
  assert.equal((await status(path)).pending, 1);
});

test("diagnostic write failure cannot suppress capture or expose private paths", async (t) => {
  const path = await root(t);
  const b = bundle();
  const issuedAt = Date.now() - 5000;
  b.binding.issuedAt = new Date(issuedAt).toISOString();
  b.binding.acceptUntil = new Date(issuedAt + 7 * 86400000).toISOString();
  await setup(path, b);
  // A directory at the diagnostic filename prevents atomic replacement.
  await mkdir(join(path, "capture-diagnostic.json"), { mode: 0o700 });
  const result = runCLI(path, "capture", input);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.match(result.stderr, /wellspent_capture:diagnostic_unavailable/);
  assert.equal(result.stderr.includes(path), false);
  assert.equal((await status(path)).pending, 1);
});

async function http(port, path, body, headers = {}, method = "POST") {
  return new Promise((resolve, reject) => {
    const bytes = typeof body === "string" ? body : JSON.stringify(body);
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(bytes),
          ...headers,
        },
      },
      (res) => {
        const parts = [];
        res.on("data", (p) => parts.push(p));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(parts).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(bytes);
  });
}
async function availablePort() {
  const { createServer } = await import("node:net");
  const s = createServer();
  await new Promise((resolve, reject) => {
    s.once("error", reject);
    s.listen(0, "127.0.0.1", resolve);
  });
  const address = s.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  await new Promise((resolve) => s.close(resolve));
  return address.port;
}
test("real HTTP restricts method host path origin limits, authenticates and does not drain", async (t) => {
  const path = await root(t);
  const port = await availablePort();
  const b = bundle(port);
  await setup(path, b);
  await capture(path, input, now);
  const server = await serve(path);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const current = new Date();
  const p = poll(undefined, current);
  assert.equal((await http(port, "/v1/poll", p)).status, 200);
  assert.equal((await http(port, "/v1/poll", p)).status, 400);
  assert.equal((await status(path)).pending, 1);
  for (const [route, headers, method, bytes] of [
    ["/v1/poll?x=1", {}, "POST", p],
    ["/v1/poll", { host: `localhost:${port}` }, "POST", p],
    ["/v1/poll", { origin: "http://evil.example" }, "POST", p],
    ["/v1/poll", {}, "GET", p],
    ["/v1/poll", {}, "POST", "x".repeat(16385)],
  ])
    assert.equal((await http(port, route, bytes, headers, method)).status, 400);
});

test("helper SIGKILL across pending delivery and ACK preserves original packet and ID receipt", async (t) => {
  const path = await root(t);
  const port = await availablePort();
  await setup(path, bundle(port));
  await capture(path, input, now);
  async function start() {
    const child = spawn(process.execPath, [cli, "--root", path, "serve"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => child.kill("SIGKILL"));
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("exit", (code) => reject(new Error(`helper exited ${code}`)));
      child.once("error", reject);
    });
    return child;
  }
  async function kill(child) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
  }
  let child = await start();
  const first = JSON.parse(
    (await http(port, "/v1/poll", poll(undefined, new Date()))).body,
  ).packet;
  await kill(child);
  child = await start();
  const replay = JSON.parse(
    (await http(port, "/v1/poll", poll(undefined, new Date()))).body,
  ).packet;
  assert.deepEqual(replay, first);
  assert.equal((await http(port, "/v1/ack", ack(first))).status, 200);
  await kill(child);
  child = await start();
  assert.equal((await http(port, "/v1/ack", ack(first))).status, 200);
  assert.equal(
    JSON.parse((await http(port, "/v1/poll", poll(undefined, new Date()))).body)
      .packet,
    null,
  );
  await kill(child);
});

test("Swift uppercase UUID requests and ACKs use canonical file paths", async (t) => {
  const path = await root(t);
  const b = bundle();
  b.binding.bindingID = "ABCDEF11-1111-4111-A111-ABCDEF111111";
  await setup(path, b);
  await capture(path, input, now);
  const packet = (
    await dispatch(
      path,
      "/v1/poll",
      poll(b.binding.bindingID.toUpperCase()),
      now,
    )
  ).packet;
  const value = decode(ack(packet)).value;
  value.eventID = value.eventID.toUpperCase();
  await dispatch(path, "/v1/ack", sign(value, key, "ack"), now);
  assert.equal((await status(path)).pending, 0);
  assert.equal((await capture(path, input, now)).duplicate, true);
});

test("dead process lock recovery and concurrent producers preserve a single identity", async (t) => {
  const path = await root(t);
  await setup(path, bundle());
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const deadPID = child.pid;
  await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(typeof deadPID, "number");
  await mkdir(join(path, ".lock"), { mode: 0o700 });
  await writeFile(
    join(path, ".lock", `${deadPID}-${randomUUID()}.json`),
    JSON.stringify({ pid: deadPID }),
    { mode: 0o600 },
  );
  await capture(path, input, now);
  const subprocesses = Array.from(
    { length: 8 },
    () =>
      new Promise((resolve, reject) => {
        const worker = spawn(
          process.execPath,
          [cli, "--root", path, "capture"],
          { stdio: ["pipe", "pipe", "pipe"] },
        );
        worker.once("error", reject);
        worker.once("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`producer ${code}`)),
        );
        worker.stdin.end(JSON.stringify(input));
      }),
  );
  await Promise.all(subprocesses);
  assert.equal((await status(path)).pending, 1);
  const packet = (await dispatch(path, "/v1/poll", poll(), now)).packet;
  assert.equal(decode(packet).value.hookReceivedAt, now.toISOString());
});

test("queue capacity excludes new packets with a content-free reason and bounded file reads", async (t) => {
  const path = await root(t);
  await setup(path, bundle());
  await Promise.all(
    Array.from({ length: 1000 }, () =>
      writeFile(join(path, "pending", `${randomUUID()}.json`), "{}", {
        mode: 0o600,
      }),
    ),
  );
  assert.deepEqual(await capture(path, input, now), {
    queued: false,
    reason: "queue_full",
  });
  assert.equal((await status(path)).reasons.queue_full, 1);
  const b = join(path, "bindings", `${fixture.binding.bindingID}.json`);
  await writeFile(b, "x".repeat(16385));
  await assert.rejects(capture(path, input, now), /invalid_private_file/);
});

test("explicit binding retirement refuses retained packets and preserves other keys, sender and receipts", async (t) => {
  const path = await root(t);
  const first = bundle();
  await setup(path, first);
  const second = {
    ...bundle(),
    binding: {
      ...bundle().binding,
      bindingID: randomUUID(),
      threadID: "other_thread",
    },
  };
  await setup(path, second);
  await assert.rejects(
    setup(path, {
      ...first,
      binding: { ...first.binding, localScopeID: "changed-scope" },
    }),
    /binding_conflict/,
  );
  await capture(path, input, now);
  await assert.rejects(
    retire(path, first.binding.bindingID),
    /binding_has_retained_packets/,
  );
  const packet = (await dispatch(path, "/v1/poll", poll(), now)).packet;
  await dispatch(path, "/v1/ack", ack(packet), now);
  assert.deepEqual(await retire(path, first.binding.bindingID.toUpperCase()), {
    retired: first.binding.bindingID,
  });
  assert.deepEqual(await identity(path), { senderID: first.binding.senderID });
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(path, "receipts", `${decode(packet).value.eventID}.json`),
      ),
    ),
    { id: decode(packet).value.eventID },
  );
  assert.equal(
    JSON.parse(
      await readFile(
        join(path, "bindings", `${second.binding.bindingID}.json`),
      ),
    ).binding.threadID,
    "other_thread",
  );
  await assert.rejects(
    setup(path, { ...first, endpoint: "http://127.0.0.1:43872" }),
    /endpoint_mismatch/,
  );
  await retire(path, second.binding.bindingID);
  await setup(path, {
    ...first,
    endpoint: "http://127.0.0.1:43872",
    binding: { ...first.binding, bindingID: randomUUID() },
  });
  assert.deepEqual(await identity(path), { senderID: first.binding.senderID });
});

test("quarantined packets block key retirement until explicit cleanup", async (t) => {
  const path = await root(t);
  await setup(path, bundle());
  await capture(path, input, now);
  const packet = (await dispatch(path, "/v1/poll", poll(), now)).packet;
  await dispatch(
    path,
    "/v1/reject",
    sign(
      {
        version: 1,
        bindingID: fixture.binding.bindingID,
        eventID: decode(packet).value.eventID,
        bodyDigest: bodyDigest(packet),
        reason: "outsideInterval",
        nonce: randomUUID(),
        issuedAt: now.toISOString(),
      },
      key,
      "reject",
    ),
    now,
  );
  await assert.rejects(
    retire(path, fixture.binding.bindingID),
    /binding_has_retained_packets/,
  );
  await cleanup(path, "quarantine");
  const result = spawnSync(
    process.execPath,
    [cli, "--root", path, "retire", fixture.binding.bindingID],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    retired: fixture.binding.bindingID,
  });
});

test("setup CLI explains stdin mistakes without exposing pairing input", async (t) => {
  const path = await root(t);
  const marker = "private-pairing-content-must-not-leak";
  const cases = [
    { input: "", args: [], message: /received no input/ },
    {
      input: `pbpaste | node ${marker} setup`,
      args: [],
      message: /not valid JSON/,
    },
    { input: `{"key":"${marker}`, args: [], message: /not valid JSON/ },
    {
      input: JSON.stringify({ key: marker }),
      args: [],
      message: /not a complete supported/,
    },
    { input: "", args: [marker], message: /takes no arguments/ },
  ];
  for (const fixture of cases) {
    const result = spawnSync(
      process.execPath,
      [cli, "--root", path, "setup", ...fixture.args],
      {
        input: fixture.input,
        encoding: "utf8",
        timeout: 5000,
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, fixture.message);
    assert.equal(result.stderr.includes(marker), false);
  }
  assert.equal(runCLI(path, "setup", bundle()).status, 0);
});
