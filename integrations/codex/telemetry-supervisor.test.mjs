import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bodyDigest, decode, sign } from "./local-contract.mjs";
import { publish, read } from "./local-helper.mjs";
import { createTelemetrySupervisor } from "./telemetry-supervisor.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../../docs/design/probes/c3a/fixture.json", import.meta.url),
  ),
);
const key = Buffer.alloc(32, 42);
async function freeEndpoint() {
  const s = createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${s.address().port}`;
  await new Promise((resolve) => s.close(resolve));
  return endpoint;
}
async function context(t) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "telemetry-supervisor-"),
  );
  await chmod(root, 0o700);
  let now = new Date();
  const bundle = {
    version: 1,
    endpoint: await freeEndpoint(),
    key: key.toString("base64"),
    binding: {
      ...fixture.binding,
      bindingID: randomUUID(),
      issuedAt: now.toISOString(),
      acceptUntil: new Date(now.getTime() + 7 * 86400000).toISOString(),
    },
  };
  const source = join(root, "selected.jsonl");
  await writeFile(source, "PRIVATE_HISTORY\n", { mode: 0o600 });
  let runnerID = randomUUID();
  let supervisor = await createTelemetrySupervisor(root, runnerID, () => now);
  t.after(async () => {
    await supervisor.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  const request = async (action, payload = null, override = {}) => {
    const value = {
      version: 1,
      id: randomUUID(),
      runnerID,
      action,
      payload,
      requestedAt: now.toISOString(),
      ...override,
    };
    await publish(join(root, "telemetry-request.json"), value, true);
    await supervisor.processRequest();
    return {
      request: value,
      result: await read(join(root, "telemetry-result.json")),
    };
  };
  const selection = async (overrides = {}) => ({
    bindingID: bundle.binding.bindingID,
    filePath: source,
    sessionID: "session_1",
    sourceVersion: "0.157.1",
    eofOffset: (await stat(source)).size,
    endsAt: new Date(now.getTime() + 60000).toISOString(),
    maxBytes: 2097152,
    ...overrides,
  });
  const activate = async (overrides = {}) => {
    const id = randomUUID();
    await publish(
      join(root, "telemetry-permit.json"),
      {
        authorizationID: id,
        bindingID: bundle.binding.bindingID,
        enabled: true,
      },
      true,
    );
    return request(
      "activate",
      { bundle, selection: await selection(overrides) },
      { id },
    );
  };
  const append = async (id = "turn_1", path = source) =>
    appendFile(
      path,
      `${JSON.stringify({
        type: "turn_context",
        timestamp: now.toISOString(),
        payload: {
          turn_id: id,
          model: "gpt-6-sol",
          effort: "high",
          private: "PRIVATE_CANARY",
        },
      })}\n`,
    );
  const post = async (path, packet) => {
    const response = await fetch(bundle.endpoint + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(packet),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const poll = async () =>
    post(
      "/v2/poll",
      sign(
        {
          version: 1,
          bindingID: bundle.binding.bindingID,
          nonce: randomUUID(),
          issuedAt: new Date().toISOString(),
        },
        key,
        "telemetry-poll",
      ),
    );
  return {
    root,
    bundle,
    source,
    request,
    activate,
    append,
    post,
    poll,
    selection,
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
    async restart() {
      await supervisor.stop().catch(() => {});
      runnerID = randomUUID();
      supervisor = await createTelemetrySupervisor(root, runnerID, () => now);
    },
  };
}
const auth = (activation, bindingID) => ({
  authorizationID: activation.request.id,
  bindingID,
});
test("explicit activation reads only selected EOF additions, real HTTP duplicate/lost ACK and delayed delivery", async (t) => {
  const f = await context(t);
  const activation = await f.activate();
  assert.equal(
    activation.result.status,
    "ok",
    JSON.stringify(activation.result),
  );
  const other = join(f.root, "other.jsonl");
  await writeFile(other, "");
  await f.append("unselected", other);
  await f.append();
  const readResult = await f.request(
    "read",
    auth(activation, f.bundle.binding.bindingID),
  );
  assert.equal(readResult.result.reader.enabled, true);
  await f.request("stop", auth(activation, f.bundle.binding.bindingID));
  await f.append("after_stop");
  assert.equal(
    (await f.request("read", auth(activation, f.bundle.binding.bindingID)))
      .result.error,
    "authorization_required",
  );
  const first = await f.poll();
  const second = await f.poll();
  assert.deepEqual(first.packet, second.packet);
  const metadata = decode(first.packet).value;
  assert.equal(metadata.configuredModel, "gpt-6-sol");
  assert.equal(metadata.turnID, "turn_1");
  assert.equal(
    Buffer.from(first.packet.body, "base64")
      .toString()
      .includes("PRIVATE_CANARY"),
    false,
  );
  const ack = sign(
    {
      observationID: metadata.observationID,
      bodyDigest: bodyDigest(first.packet),
      nativeReceivedAt: new Date().toISOString(),
    },
    key,
    "telemetry-ack",
  );
  await f.post("/v2/ack", ack);
  await f.post("/v2/ack", ack);
  assert.equal((await f.poll()).packet, null);
});
test("restart drains unchanged queue but requires fresh authorization and binding; explicit selection may change", async (t) => {
  const f = await context(t);
  const a = await f.activate();
  await f.append();
  await f.request("read", auth(a, f.bundle.binding.bindingID));
  const before = await f.poll();
  await f.restart();
  await f.append("after_restart");
  assert.equal((await f.request("status")).result.reader.enabled, false);
  assert.equal(
    (await f.request("read", auth(a, f.bundle.binding.bindingID))).result.error,
    "authorization_required",
  );
  assert.deepEqual((await f.poll()).packet, before.packet);
  assert.equal((await f.activate()).result.error, "fresh_binding_required");
  f.bundle.binding = {
    ...f.bundle.binding,
    bindingID: randomUUID(),
    intervalID: randomUUID(),
  };
  const path = join(f.root, "new-selected.jsonl");
  await writeFile(path, "");
  const b = await f.activate({ filePath: path, eofOffset: 0 });
  assert.equal(b.result.status, "ok");
  await f.append("new_turn", path);
  assert.equal(
    (await f.request("read", auth(b, f.bundle.binding.bindingID))).result
      .status,
    "ok",
  );
});
test("expiry and byte limit stop access; wrong bindings and source failure are visible", async (t) => {
  const f = await context(t);
  const a = await f.activate();
  assert.equal(
    (await f.request("read", auth(a, randomUUID()))).result.error,
    "binding_mismatch",
  );
  f.advance(60001);
  assert.equal(
    (await f.request("status")).result.reader.status,
    "window_ended",
  );
  assert.equal(
    (await f.request("read", auth(a, f.bundle.binding.bindingID))).result.error,
    "authorization_required",
  );
  f.bundle.binding = {
    ...f.bundle.binding,
    bindingID: randomUUID(),
    intervalID: randomUUID(),
  };
  const b = await f.activate({ maxBytes: 1 });
  await f.append();
  const limit = (await f.request("read", auth(b, f.bundle.binding.bindingID)))
    .result.reader;
  assert.equal(limit.enabled, false);
  assert.equal(limit.status, "byte_limit");
  f.bundle.binding = {
    ...f.bundle.binding,
    bindingID: randomUUID(),
    intervalID: randomUUID(),
  };
  const c = await f.activate();
  assert.equal(c.result.status, "ok");
  await rm(f.source);
  const failed = (await f.request("read", auth(c, f.bundle.binding.bindingID)))
    .result.reader;
  assert.equal(failed.status, "source_unavailable");
  assert.equal(failed.enabled, false);
});
test("stale runner does not authorize; expired requests are rejected without reads", async (t) => {
  const f = await context(t);
  const inactive = await f.request("status");
  const ignored = await f.request(
    "activate",
    { bundle: f.bundle, selection: await f.selection() },
    { runnerID: randomUUID() },
  );
  assert.equal(ignored.result.id, inactive.request.id);
  assert.equal(ignored.result.reader.status, "not_selected");
  const stale = await f.request(
    "activate",
    { bundle: f.bundle, selection: await f.selection() },
    { requestedAt: new Date(Date.now() - 30000).toISOString() },
  );
  assert.equal(stale.result.error, "invalid_request");
  assert.equal(
    (await f.request("status")).result.reader.status,
    "not_selected",
  );
});
test("journal recovery failure stays isolated while HTTP queued delivery survives restart", async (t) => {
  const f = await context(t);
  const a = await f.activate();
  await f.append("before_pressure");
  await f.request("read", auth(a, f.bundle.binding.bindingID));
  const original = await f.poll();
  const fillers = Array.from({ length: 1000 }, (_, i) =>
    join(f.root, "telemetry", "telemetry-pending", `filler_${i}.json`),
  );
  await Promise.all(
    fillers.map((path) =>
      writeFile(
        path,
        JSON.stringify(sign({ bindingID: randomUUID() }, key, "telemetry")),
        { mode: 0o600 },
      ),
    ),
  );
  await f.append("blocked_publication");
  assert.equal(
    (await f.request("read", auth(a, f.bundle.binding.bindingID))).result.reader
      .status,
    "queue_full",
  );
  await f.restart();
  const failed = await f.request("status");
  assert.equal(failed.result.error, "queue_full");
  assert.equal(failed.result.reader.enabled, false);
  assert.equal(failed.result.reader.pendingPublication, true);
  const legacy = await f.post(
    "/v1/poll",
    sign(
      {
        version: 1,
        bindingID: f.bundle.binding.bindingID,
        nonce: randomUUID(),
        issuedAt: new Date().toISOString(),
      },
      key,
      "poll",
    ),
  );
  assert.equal(legacy.packet, null);
  assert.deepEqual((await f.poll()).packet, original.packet);
  assert.equal(
    (await f.request("read", auth(a, f.bundle.binding.bindingID))).result.error,
    "authorization_required",
  );
  await Promise.all(fillers.map((path) => rm(path)));
  f.bundle.binding = {
    ...f.bundle.binding,
    bindingID: randomUUID(),
    intervalID: randomUUID(),
  };
  assert.equal((await f.activate()).result.status, "ok");
});
test("revoked native permit blocks queued reads and cannot stop a newer selection", async (t) => {
  const f = await context(t);
  const a = await f.activate();
  await f.append("not_read_after_pause");
  await publish(
    join(f.root, "telemetry-permit.json"),
    {
      authorizationID: a.request.id,
      bindingID: f.bundle.binding.bindingID,
      enabled: false,
    },
    true,
  );
  const result = await f.request("read", auth(a, f.bundle.binding.bindingID));
  assert.equal(result.result.reader.status, "stopped");
  assert.equal(result.result.reader.enabled, false);
  assert.equal((await f.poll()).packet, null);
  const oldBinding = f.bundle.binding.bindingID;
  f.bundle.binding = {
    ...f.bundle.binding,
    bindingID: randomUUID(),
    intervalID: randomUUID(),
  };
  const b = await f.activate();
  assert.equal(b.result.status, "ok");
  assert.equal(
    (await f.request("stop", auth(a, oldBinding))).result.error,
    "authorization_required",
  );
  await f.append("new_authorized_turn");
  assert.equal(
    (await f.request("read", auth(b, f.bundle.binding.bindingID))).result.reader
      .enabled,
    true,
  );
});
test("native reopen can explicitly replace retained authorization without opening the old source", async (t) => {
  const f = await context(t);
  const old = await f.activate();
  const oldBinding = f.bundle.binding.bindingID;
  const nextSource = join(f.root, "after-native-reopen.jsonl");
  await writeFile(nextSource, "", { mode: 0o600 });
  f.bundle.binding = {
    ...f.bundle.binding,
    bindingID: randomUUID(),
    intervalID: randomUUID(),
  };
  const selection = await f.selection({ filePath: nextSource, eofOffset: 0 });
  await rm(f.source);
  const id = randomUUID();
  await publish(
    join(f.root, "telemetry-permit.json"),
    {
      authorizationID: id,
      bindingID: f.bundle.binding.bindingID,
      enabled: true,
    },
    true,
  );
  const next = await f.request(
    "activate",
    { bundle: f.bundle, selection },
    { id },
  );
  assert.equal(next.result.status, "ok");
  assert.equal(next.result.reader.enabled, true);
  assert.equal(
    (await f.request("read", auth(old, oldBinding))).result.error,
    "authorization_required",
  );
  await f.append("new_native_client", nextSource);
  await f.request("read", auth(next, f.bundle.binding.bindingID));
  assert.equal(
    decode((await f.poll()).packet).value.turnID,
    "new_native_client",
  );
});

test("expiry permits fresh activation without an intervening status or read request", async (t) => {
  const f = await context(t);
  await f.activate();
  f.advance(60001);
  f.bundle.binding = {
    ...f.bundle.binding,
    bindingID: randomUUID(),
    intervalID: randomUUID(),
  };
  const next = await f.activate();
  assert.equal(next.result.status, "ok");
  assert.equal(next.result.reader.enabled, true);
});
