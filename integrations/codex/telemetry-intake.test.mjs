import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bodyDigest, decode, sign } from "./local-contract.mjs";
import {
  capture,
  cleanup,
  dispatch,
  enqueueTelemetry,
  openLocalRoot,
  publish,
  read,
  setup,
  status,
} from "./local-helper.mjs";
import {
  telemetryFromSynthetic,
  validateTelemetry,
} from "./telemetry-contract.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../../docs/design/probes/c3a/fixture.json", import.meta.url),
  ),
);
const vector = JSON.parse(
  await readFile(
    new URL(
      "../../docs/design/probes/c4/telemetry-fixture.json",
      import.meta.url,
    ),
  ),
);
const key = Buffer.alloc(32, 42);
const at = new Date("2027-01-15T08:00:06.000Z");
const bundle = {
  version: 1,
  endpoint: "http://127.0.0.1:43871",
  key: key.toString("base64"),
  binding: {
    ...fixture.binding,
    issuedAt: "2027-01-15T08:00:00.000Z",
    acceptUntil: "2027-01-22T08:00:00.000Z",
  },
};
const request = (domain) =>
  sign(
    {
      version: 1,
      bindingID: bundle.binding.bindingID,
      nonce: randomUUID(),
      issuedAt: at.toISOString(),
    },
    key,
    domain,
  );
const response = (id = "response_1") => ({
  sourceVersion: "0.157.1",
  kind: "responseUsage",
  sessionID: "session_1",
  rootTurnID: "root_1",
  turnID: "turn_1",
  responseID: id,
  sourceWrittenAt: "2027-01-15T08:00:05.000Z",
  usage: {
    inputTokens: 20,
    cachedInputTokens: 10,
    cacheWriteInputTokens: null,
    outputTokens: 3,
    reasoningOutputTokens: 1,
    totalTokens: 23,
  },
  privateTranscript: "PRIVATE_CANARY",
  cumulativeTokenCount: 99999,
});
async function root(t) {
  const path = await mkdtemp(
    join(await realpath(tmpdir()), "wellspent-telemetry-test-"),
  );
  await chmod(path, 0o700);
  t.after(() => rm(path, { recursive: true, force: true }));
  const opened = await openLocalRoot(path);
  await setup(opened, bundle);
  return opened;
}

test("capability gate, separate v1 queue, allowlist and commit-before-ACK spool", async (t) => {
  const path = await root(t);
  const inserted = await enqueueTelemetry(
    path,
    bundle.binding.bindingID,
    response(),
    at,
  );
  const same = await enqueueTelemetry(
    path,
    bundle.binding.bindingID,
    response(),
    at,
  );
  assert.equal(same.duplicate, true);
  assert.equal(inserted.observationID, same.observationID);
  await assert.rejects(
    enqueueTelemetry(
      path,
      bundle.binding.bindingID,
      {
        ...response(),
        usage: { ...response().usage, inputTokens: 21, totalTokens: 24 },
      },
      at,
    ),
    /identityConflict/,
  );
  assert.deepEqual(
    await dispatch(
      path,
      "/v2/capabilities",
      request("telemetry-capabilities"),
      at,
    ),
    { capabilities: ["codex-telemetry-v1", "codex-telemetry-preview-v1"] },
  );
  assert.equal(
    (await dispatch(path, "/v1/poll", request("poll"), at)).packet,
    null,
  );
  assert.equal((await status(path)).pending, 0);
  const first = await dispatch(path, "/v2/poll", request("telemetry-poll"), at);
  assert.equal(first.pending, 1);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_CANARY|99999/);
  const value = validateTelemetry(decode(first.packet).value);
  assert.equal(value.usage.totalTokens, 23);
  assert.equal(value.usage.cachedInputTokens, 10);
  assert.equal(value.configuredModel, null);
  assert.equal(
    (await dispatch(path, "/v2/poll", request("telemetry-poll"), at)).packet
      .body,
    first.packet.body,
  );
  const ack = sign(
    {
      observationID: value.observationID,
      bodyDigest: bodyDigest(first.packet),
      nativeReceivedAt: at.toISOString(),
    },
    key,
    "telemetry-ack",
  );
  assert.deepEqual(await dispatch(path, "/v2/ack", ack, at), { ok: true });
  assert.deepEqual(await dispatch(path, "/v2/ack", ack, at), { ok: true });
  assert.equal(
    (await dispatch(path, "/v2/poll", request("telemetry-poll"), at)).pending,
    0,
  );
  await assert.rejects(
    enqueueTelemetry(
      path,
      bundle.binding.bindingID,
      {
        ...response(),
        usage: { ...response().usage, inputTokens: 21, totalTokens: 24 },
      },
      at,
    ),
    /identityConflict/,
  );
  assert.equal(await openLocalRoot(path), path);
  assert.equal(
    (await dispatch(path, "/v1/poll", request("poll"), at)).packet,
    null,
  );
});

test("configuration and reordered response atoms stay separate; unsupported packet retained", async (t) => {
  const path = await root(t);
  const config = {
    sourceVersion: "0.157.1",
    kind: "turnConfiguration",
    sessionID: "session_1",
    rootTurnID: "root_1",
    turnID: "turn_1",
    responseID: null,
    sourceWrittenAt: "2027-01-15T08:00:05.000Z",
    configuredModel: "gpt-6-sol",
    configuredEffort: "medium",
  };
  await enqueueTelemetry(
    path,
    bundle.binding.bindingID,
    response("response_2"),
    at,
  );
  await enqueueTelemetry(path, bundle.binding.bindingID, config, at);
  await enqueueTelemetry(
    path,
    bundle.binding.bindingID,
    response("response_1"),
    at,
  );
  const invalid = {
    ...telemetryFromSynthetic(response("response_old"), bundle.binding, at),
    version: 2,
  };
  await publish(
    join(path, "telemetry-pending", `${invalid.observationID}.json`),
    sign(invalid, key, "telemetry"),
  );
  const result = await dispatch(
    path,
    "/v2/poll",
    request("telemetry-poll"),
    at,
  );
  assert.equal(result.pending, 4);
  assert.equal(result.unsupported, 1);
  assert.ok(result.packet);
  assert.equal(
    (
      await read(
        join(path, "telemetry-pending", `${invalid.observationID}.json`),
      )
    ).body,
    sign(invalid, key, "telemetry").body,
  );
  assert.equal(
    (await dispatch(path, "/v1/poll", request("poll"), at)).packet,
    null,
  );
  await assert.rejects(
    dispatch(path, "/v2/poll", request("poll"), at),
    /untrustedSender/,
  );
  assert.throws(() => validateTelemetry(invalid), /invalidPacket/);
  assert.throws(
    () =>
      telemetryFromSynthetic(
        { ...response(), usage: null },
        bundle.binding,
        at,
      ),
    /invalidPacket/,
  );
  assert.throws(
    () =>
      telemetryFromSynthetic(
        { ...response(), sourceVersion: "0.158.0" },
        bundle.binding,
        at,
      ),
    /invalidPacket/,
  );
});

test("telemetry receipt cleanup frees acknowledged capacity without deleting pending observations", async (t) => {
  const path = await root(t);
  await enqueueTelemetry(path, bundle.binding.bindingID, response(), at);
  const packet = (
    await dispatch(path, "/v2/poll", request("telemetry-poll"), at)
  ).packet;
  const receipt = sign(
    {
      observationID: decode(packet).value.observationID,
      bodyDigest: bodyDigest(packet),
      nativeReceivedAt: at.toISOString(),
    },
    key,
    "telemetry-ack",
  );
  await dispatch(path, "/v2/ack", receipt, at);
  await enqueueTelemetry(
    path,
    bundle.binding.bindingID,
    response("response_2"),
    at,
  );
  assert.deepEqual(await cleanup(path, "telemetry-receipts"), { removed: 1 });
  assert.equal((await readdir(join(path, "telemetry-pending"))).length, 1);
  const second = (
    await dispatch(path, "/v2/poll", request("telemetry-poll"), at)
  ).packet;
  await dispatch(
    path,
    "/v2/ack",
    sign(
      {
        observationID: decode(second).value.observationID,
        bodyDigest: bodyDigest(second),
        nativeReceivedAt: at.toISOString(),
      },
      key,
      "telemetry-ack",
    ),
    at,
  );
  assert.equal((await readdir(join(path, "telemetry-pending"))).length, 0);
});

test("v1 capture remains independent of telemetry admission", async (t) => {
  const path = await root(t);
  await enqueueTelemetry(path, bundle.binding.bindingID, response(), at);
  const hook = {
    hook_event_name: "PostToolUse",
    session_id: bundle.binding.threadID,
    turn_id: "turn_1",
    tool_use_id: "tool_1",
    tool_name: "Bash",
    tool_response: { exit_code: 0 },
  };
  assert.equal((await capture(path, hook, at)).queued, true);
  assert.ok((await dispatch(path, "/v1/poll", request("poll"), at)).packet);
  assert.ok(
    (await dispatch(path, "/v2/poll", request("telemetry-poll"), at)).packet,
  );
  assert.equal((await status(path)).pending, 1);
});

test("Node and Swift share synthetic signed telemetry vectors", () => {
  const binding = vector.binding;
  const receivedAt = new Date("2027-01-15T08:00:06.000Z");
  const source = {
    sourceVersion: "0.157.1",
    sessionID: "session_1",
    rootTurnID: "root_1",
    turnID: "turn_1",
    sourceWrittenAt: "2027-01-15T08:00:05.000Z",
  };
  const config = telemetryFromSynthetic(
    {
      ...source,
      kind: "turnConfiguration",
      configuredModel: "gpt-6-sol",
      configuredEffort: "medium",
      privateCanary: "SECRET",
    },
    binding,
    receivedAt,
  );
  const usage = telemetryFromSynthetic(
    {
      ...source,
      kind: "responseUsage",
      responseID: "response_1",
      usage: response().usage,
      privateCanary: "SECRET",
    },
    binding,
    receivedAt,
  );
  assert.deepEqual(sign(config, key, "telemetry"), vector.configuration);
  assert.deepEqual(sign(usage, key, "telemetry"), vector.responseUsage);
  assert.doesNotMatch(JSON.stringify(vector), /SECRET/);
});

test("optional assigned chat name preserves legacy identity and rejects invalid names", () => {
  for (const invalid of [null, undefined, 5, {}]) {
    assert.throws(() => validateTelemetry(invalid), /invalidPacket/);
  }
  const old = telemetryFromSynthetic(response(), bundle.binding, at);
  assert.equal(Object.hasOwn(old, "threadName"), false);
  const named = telemetryFromSynthetic(
    {
      ...response(),
      threadName: "Fix timeline — chat 🧭",
      preview: "PRIVATE_CANARY",
    },
    bundle.binding,
    at,
  );
  assert.equal(named.threadName, "Fix timeline — chat 🧭");
  assert.equal(named.observationID, old.observationID);
  assert.equal(JSON.stringify(named).includes("PRIVATE_CANARY"), false);
  for (const threadName of [
    "",
    "  ",
    "bad\nname",
    "x".repeat(501),
    "🧭".repeat(126),
    5,
    null,
  ]) {
    assert.throws(
      () => validateTelemetry({ ...old, threadName }),
      /invalidPacket/,
    );
  }
});
