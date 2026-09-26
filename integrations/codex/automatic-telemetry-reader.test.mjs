import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
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
async function context(t) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "automatic-codex-"),
  );
  await chmod(root, 0o700);
  const directory = join(root, "sessions");
  await mkdir(directory, { mode: 0o700 });
  const socket = createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${socket.address().port}`;
  await new Promise((r) => socket.close(r));
  const key = Buffer.alloc(32, 42);
  let now = new Date(),
    runnerID = randomUUID(),
    authorizationID;
  let supervisor = await createTelemetrySupervisor(root, runnerID, () => now);
  t.after(async () => {
    await supervisor.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  async function permit(
    enabled = true,
    expiresAt = new Date(now.getTime() + 15000).toISOString(),
  ) {
    await publish(
      join(root, "telemetry-permit.json"),
      { authorizationID, runnerID, enabled, expiresAt },
      true,
    );
  }
  async function request(action, payload = null, id = randomUUID()) {
    await publish(
      join(root, "telemetry-request.json"),
      {
        version: 1,
        id,
        runnerID,
        action,
        payload,
        requestedAt: now.toISOString(),
      },
      true,
    );
    await supervisor.processRequest();
    return read(join(root, "telemetry-result.json"));
  }
  async function activate(selectedDirectory = directory) {
    authorizationID = randomUUID();
    await permit();
    return request(
      "directoryActivate",
      { directoryPath: selectedDirectory },
      authorizationID,
    );
  }
  async function action(action, renew = true) {
    if (renew) await permit();
    return request(action, { authorizationID });
  }
  async function source(name, version = "0.157.1", extra = "") {
    const path = join(directory, `${name}.jsonl`);
    await writeFile(
      path,
      `${JSON.stringify({ type: "session_meta", payload: { id: name, session_id: name, cli_version: version, private: "HEADER_PRIVATE_CANARY" } })}\n${extra}`,
      { mode: 0o600 },
    );
    return path;
  }
  async function append(path, turn = "turn", usage = false) {
    await appendFile(
      path,
      `${JSON.stringify({ type: usage ? "token_usage_record" : "turn_context", timestamp: now.toISOString(), payload: usage ? { thread_id: path.split("/").at(-1).replace(".jsonl", ""), session_id: path.split("/").at(-1).replace(".jsonl", ""), turn_id: turn, root_turn_id: turn, response_id: `response_${turn}`, usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 3, reasoning_output_tokens: 0, total_tokens: 23 } } : { turn_id: turn, model: "gpt-6-sol", effort: "high", private: "CONTENT_PRIVATE_CANARY" } })}\n`,
    );
  }
  async function enroll(candidate, overrides = {}) {
    const bundle = {
      version: 1,
      endpoint,
      key: key.toString("base64"),
      binding: {
        ...fixture.binding,
        bindingID: randomUUID(),
        threadID: candidate.threadID,
        issuedAt: now.toISOString(),
        acceptUntil: new Date(
          Date.parse(overrides.issuedAt ?? now.toISOString()) + 7 * 86400000,
        ).toISOString(),
        ...overrides,
      },
    };
    await permit();
    const result = await request("directoryEnroll", {
      authorizationID,
      sourceID: candidate.sourceID,
      bundle,
    });
    return { bundle, result };
  }
  async function post(path, packet) {
    const response = await fetch(endpoint + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(packet),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function poll(bundle, legacy = false) {
    return post(
      legacy ? "/v1/poll" : "/v2/poll",
      sign(
        {
          version: 1,
          bindingID: bundle.binding.bindingID,
          nonce: randomUUID(),
          issuedAt: new Date().toISOString(),
        },
        key,
        legacy ? "poll" : "telemetry-poll",
      ),
    );
  }
  async function ack(packet) {
    await post(
      "/v2/ack",
      sign(
        {
          observationID: decode(packet).value.observationID,
          bodyDigest: bodyDigest(packet),
          nativeReceivedAt: new Date().toISOString(),
        },
        key,
        "telemetry-ack",
      ),
    );
  }
  return {
    root,
    directory,
    source,
    append,
    activate,
    action,
    enroll,
    poll,
    ack,
    permit,
    request,
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

test("automatic multiple-source EOF enrollment, creation races, real HTTP packets, delayed/lost ACK and selection isolation", async (t) => {
  const f = await context(t);
  const first = await f.source("first");
  await f.append(first, "historical");
  const second = await f.source("second");
  const outside = join(f.root, "outside.jsonl");
  await writeFile(outside, "PRIVATE_OUTSIDE\n");
  await symlink(outside, join(f.directory, "linked.jsonl"));
  const activated = await f.activate();
  assert.equal(activated.status, "ok");
  assert.equal(activated.reader.candidates.length, 2);
  await f.append(first, "before_grant");
  const one = await f.enroll(
    activated.reader.candidates.find((c) => c.threadID === "first"),
  );
  const two = await f.enroll(
    activated.reader.candidates.find((c) => c.threadID === "second"),
  );
  assert.equal(one.result.status, "ok");
  assert.equal(two.result.status, "ok");
  await f.append(first, "eligible_first");
  await f.append(first, "eligible_first", true);
  await f.append(second, "eligible_second");
  await f.action("directoryRead");
  const packet = (await f.poll(one.bundle)).packet;
  assert.equal(decode(packet).value.turnID, "eligible_first");
  assert.deepEqual((await f.poll(one.bundle)).packet, packet);
  assert.equal(
    Buffer.from(packet.body, "base64").toString().includes("PRIVATE_CANARY"),
    false,
  );
  const third = await f.source("third");
  await f.append(third, "before_discovery");
  const discovered = await f.action("directoryDiscover");
  await f.append(third, "discovery_enrollment_gap");
  const three = await f.enroll(
    discovered.reader.candidates.find((c) => c.threadID === "third"),
  );
  await f.append(third, "eligible_third");
  await f.action("directoryRead");
  assert.equal(
    decode((await f.poll(three.bundle)).packet).value.turnID,
    "eligible_third",
  );
  assert.equal(
    decode((await f.poll(two.bundle)).packet).value.turnID,
    "eligible_second",
  );
  await f.action("directoryStop");
  await f.append(first, "finished_gap");
  await f.ack(packet);
  await f.ack(packet);
  const response = (await f.poll(one.bundle)).packet;
  assert.deepEqual(
    new Set([decode(packet).value.kind, decode(response).value.kind]),
    new Set(["turnConfiguration", "responseUsage"]),
  );
  await f.ack(response);
  assert.equal((await f.poll(one.bundle)).packet, null);
  assert.equal((await f.poll(one.bundle, true)).packet, null);
});

test("stopped automatic bindings remain available for pending ACKs and retire after delivery", async (t) => {
  const f = await context(t);
  const path = await f.source("drain");
  const first = await f.activate();
  const enrollment = await f.enroll(first.reader.candidates[0]);
  assert.equal(enrollment.result.status, "ok");
  await f.append(path, "queued");
  await f.action("directoryRead");
  const packet = (await f.poll(enrollment.bundle)).packet;
  assert.ok(packet);
  await f.action("directoryStop");
  const bindingPath = join(
    f.root,
    "telemetry",
    "bindings",
    `${enrollment.bundle.binding.bindingID}.json`,
  );
  assert.equal(
    (await read(bindingPath)).binding.bindingID,
    enrollment.bundle.binding.bindingID,
  );
  await f.ack(packet);
  const next = await f.activate();
  const fresh = await f.enroll(next.reader.candidates[0]);
  assert.equal(fresh.result.status, "ok");
  await assert.rejects(read(bindingPath), { code: "ENOENT" });
  assert.equal(
    (
      await read(
        join(
          f.root,
          "telemetry",
          "bindings",
          `${fresh.bundle.binding.bindingID}.json`,
        ),
      )
    ).binding.bindingID,
    fresh.bundle.binding.bindingID,
  );
});

test("pause and explicit resume create fresh bindings and partial-line baselines exclude all boundary suffixes", async (t) => {
  const f = await context(t);
  const path = await f.source("partial");
  let a = await f.activate();
  const original = await f.enroll(a.reader.candidates[0]);
  await f.append(path, "before_pause");
  await f.action("directoryRead");
  const first = (await f.poll(original.bundle)).packet;
  await f.permit(false);
  await f.append(path, "queued_after_pause");
  const stopped = await f.action("directoryRead", false);
  assert.equal(stopped.reader.enabled, false);
  await appendFile(path, '{"type":"turn_context","payload":');
  a = await f.activate();
  const next = await f.enroll(a.reader.candidates[0], {
    intervalID: randomUUID(),
  });
  assert.notEqual(
    next.bundle.binding.bindingID,
    original.bundle.binding.bindingID,
  );
  await appendFile(path, '{"turn_id":"partial_gap"}}\n');
  await f.append(path, "resumed");
  await f.action("directoryRead");
  assert.equal(
    decode((await f.poll(next.bundle)).packet).value.turnID,
    "resumed",
  );
  assert.deepEqual((await f.poll(original.bundle)).packet, first);
});

test("lease expiry, revoked permit, helper restart and app-reopen consent cannot reuse persisted authority", async (t) => {
  const f = await context(t);
  const path = await f.source("restart");
  let a = await f.activate();
  const old = await f.enroll(a.reader.candidates[0]);
  await f.append(path, "saved");
  await f.action("directoryRead");
  const packet = (await f.poll(old.bundle)).packet;
  f.advance(15001);
  await f.append(path, "expired");
  assert.equal(
    (await f.action("directoryRead", false)).reader.status,
    "expired",
  );
  await f.restart();
  assert.equal(
    (await f.action("directoryRead")).error,
    "authorization_required",
  );
  assert.deepEqual((await f.poll(old.bundle)).packet, packet);
  a = await f.activate();
  const fresh = await f.enroll(a.reader.candidates[0]);
  await f.append(path, "fresh");
  await f.action("directoryRead");
  assert.equal(
    decode((await f.poll(fresh.bundle)).packet).value.turnID,
    "fresh",
  );
  // A newly published app consent retires the old process-local capture; baseline excludes reopen gaps.
  await f.append(path, "reopen_gap");
  a = await f.activate();
  const reopened = await f.enroll(a.reader.candidates[0]);
  await f.append(path, "after_reopen");
  await f.action("directoryRead");
  assert.equal(
    decode((await f.poll(reopened.bundle)).packet).value.turnID,
    "after_reopen",
  );
});

test("source permission loss, unsupported versions and replacement are isolated with no automatic replacement enrollment", async (t) => {
  const f = await context(t);
  const bad = await f.source("bad");
  const healthy = await f.source("healthy");
  await f.source("unsupported", "999.0");
  let a = await f.activate();
  assert.equal(a.reader.counts.unsupported_source_version, 1);
  const one = await f.enroll(
    a.reader.candidates.find((c) => c.threadID === "bad"),
  );
  const two = await f.enroll(
    a.reader.candidates.find((c) => c.threadID === "healthy"),
  );
  await chmod(bad, 0);
  await f.append(healthy, "healthy_one");
  a = await f.action("directoryRead");
  assert.equal(a.reader.enabled, true);
  assert.equal(
    a.reader.sources.find((s) => s.bindingID === one.bundle.binding.bindingID)
      .status,
    "source_permission",
  );
  assert.equal(
    decode((await f.poll(two.bundle)).packet).value.turnID,
    "healthy_one",
  );
  await chmod(bad, 0o600);
  await rename(bad, join(f.root, "retired"));
  await f.source("bad");
  a = await f.action("directoryDiscover");
  assert.equal(a.reader.candidates.length, 0);
  assert.ok(a.reader.counts.source_replaced > 0);
  assert.equal((await f.poll(one.bundle)).packet, null);
});

test("source enrollment and enumeration are bounded, depth is fixed, unsupported and oversized headers are visible", async (t) => {
  const f = await context(t);
  await mkdir(join(f.directory, "2026", "09", "26", "27"), { recursive: true });
  await writeFile(
    join(f.directory, "2026", "09", "26", "27", "too-deep.jsonl"),
    "PRIVATE\n",
  );
  await writeFile(join(f.directory, "oversized.jsonl"), "x".repeat(65536));
  let a = await f.activate();
  assert.equal(a.reader.counts.header_limit, 1);
  for (let i = 0; i < 17; i++)
    await f.source(`source_${String(i).padStart(2, "0")}`);
  a = await f.action("directoryDiscover");
  assert.equal(a.reader.candidates.length, 16);
  assert.ok(a.reader.counts.source_limit > 0);
  for (let i = 0; i < 513; i++)
    await writeFile(join(f.directory, `entry_${i}.txt`), "");
  a = await f.action("directoryDiscover");
  assert.equal(a.reader.status, "discovery_limit");
  assert.equal(a.reader.enabled, true);
});

test("partial first header is retried, stale grant is rejected, and post-discovery source replacement cannot enroll", async (t) => {
  const f = await context(t);
  const path = join(f.directory, "new.jsonl");
  await writeFile(path, '{"type":"session_meta",');
  let a = await f.activate();
  assert.equal(a.reader.candidates.length, 0);
  await appendFile(
    path,
    '"payload":{"id":"new","session_id":"new","cli_version":"0.157.1"}}\n',
  );
  a = await f.action("directoryDiscover");
  assert.equal(a.reader.candidates.length, 1);
  const stale = await f.enroll(a.reader.candidates[0], {
    issuedAt: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(stale.result.error, "fresh_binding_required");
  await rename(path, join(f.root, "original"));
  await f.source("new");
  const replacement = await f.enroll(a.reader.candidates[0]);
  assert.equal(replacement.result.status, "ok");
  assert.equal(replacement.result.reader.sources[0].status, "source_replaced");
  assert.equal(replacement.result.reader.sources[0].enabled, false);
});

test("leases renew during active consent but late renewal cannot resurrect an expired authorization", async (t) => {
  const f = await context(t);
  const path = await f.source("lease");
  const a = await f.activate();
  const item = await f.enroll(a.reader.candidates[0]);
  for (let i = 0; i < 3; i++) {
    f.advance(10000);
    assert.equal((await f.action("directoryRead")).reader.enabled, true);
  }
  f.advance(15001);
  await f.append(path, "after_expiry");
  assert.equal((await f.action("directoryRead")).reader.status, "expired");
  assert.equal((await f.poll(item.bundle)).packet, null);
});

test("manual and automatic controller transitions retain the same spool and queued original bytes", async (t) => {
  const f = await context(t);
  const path = await f.source("shared");
  let a = await f.activate();
  const first = await f.enroll(a.reader.candidates[0]);
  await f.append(path, "automatic_one");
  await f.action("directoryRead");
  const original = (await f.poll(first.bundle)).packet;
  await f.action("directoryStop");
  const id = randomUUID();
  const bindingID = randomUUID();
  const bundle = {
    ...first.bundle,
    binding: { ...first.bundle.binding, bindingID },
  };
  await publish(
    join(f.root, "telemetry-permit.json"),
    { authorizationID: id, bindingID, enabled: true },
    true,
  );
  const result = await f.request(
    "activate",
    {
      bundle,
      selection: {
        bindingID,
        filePath: path,
        sessionID: "shared",
        sourceVersion: "0.157.1",
        eofOffset: (await readFile(path)).length,
        endsAt: new Date(Date.now() + 60000).toISOString(),
        maxBytes: 2097152,
      },
    },
    id,
  );
  assert.equal(result.status, "ok");
  await f.append(path, "manual_one");
  await f.request("read", { authorizationID: id, bindingID });
  const manual = (await f.poll(bundle)).packet;
  assert.equal(decode(manual).value.turnID, "manual_one");
  a = await f.activate();
  const next = await f.enroll(a.reader.candidates[0]);
  await f.append(path, "automatic_two");
  await f.action("directoryRead");
  assert.equal(
    decode((await f.poll(next.bundle)).packet).value.turnID,
    "automatic_two",
  );
  assert.deepEqual((await f.poll(first.bundle)).packet, original);
  assert.deepEqual((await f.poll(bundle)).packet, manual);
});

test("the explicitly selected directory resolves once to a pinned physical root; linked child directories stay excluded", async (t) => {
  const f = await context(t);
  await f.source("physical");
  const alias = join(f.root, "selected-alias");
  await symlink(f.directory, alias);
  const outside = join(f.root, "unselected");
  await mkdir(outside);
  await writeFile(join(outside, "private.jsonl"), "PRIVATE_OUTSIDE\n");
  await symlink(outside, join(f.directory, "2027"));
  const a = await f.activate(alias);
  assert.equal(a.status, "ok");
  assert.equal(a.reader.candidates.length, 1);
  assert.equal(a.reader.candidates[0].threadID, "physical");
  assert.ok(a.reader.counts.symlink_excluded > 0);
});

test("header changes between discovery and the native binding fail enrollment without collecting rewritten version data", async (t) => {
  const f = await context(t);
  const path = await f.source("changed");
  const a = await f.activate();
  await f.source("changed", "0.999.9");
  const item = await f.enroll(a.reader.candidates[0]);
  assert.equal(item.result.reader.sources[0].status, "source_rewritten");
  assert.equal((await f.poll(item.bundle)).packet, null);
  assert.ok((await readFile(path)).includes(Buffer.from("0.999.9")));
});

test("startup isolates failed manual and automatic journals while another source recovers original bytes over HTTP", async (t) => {
  const f = await context(t);
  const first = await f.source("broken");
  const second = await f.source("recoverable");
  const a = await f.activate();
  const sourceA = a.reader.candidates.find((c) => c.threadID === "broken");
  const sourceB = a.reader.candidates.find((c) => c.threadID === "recoverable");
  assert.ok(sourceA);
  assert.ok(sourceB);
  const one = await f.enroll(sourceA);
  const two = await f.enroll(sourceB);
  await f.append(first, "first");
  await f.append(second, "second");
  await f.action("directoryRead");
  const original = (await f.poll(two.bundle)).packet;
  const base = join(f.root, "telemetry");
  const firstRoot = join(base, "automatic-readers", sourceA.sourceID);
  const secondRoot = join(base, "automatic-readers", sourceB.sourceID);
  const firstState = await read(join(firstRoot, "state.json"));
  firstState.journal = { key: "broken", signature: "broken" };
  await publish(join(firstRoot, "state.json"), firstState, true);
  const secondState = await read(join(secondRoot, "state.json"));
  const names = await readdir(join(secondRoot, "observations"));
  assert.ok(names[0]);
  secondState.journal = await read(join(secondRoot, "observations", names[0]));
  await publish(join(secondRoot, "state.json"), secondState, true);
  const manualRoot = join(base, "selected-reader");
  await mkdir(join(manualRoot, "observations"), {
    recursive: true,
    mode: 0o700,
  });
  await publish(
    join(manualRoot, "state.json"),
    {
      version: 1,
      active: true,
      status: "selected",
      cursor: 0,
      gaps: 0,
      counts: {},
      journal: { key: "broken", signature: "broken" },
    },
    true,
  );
  await f.restart();
  const state = await read(join(secondRoot, "state.json"));
  assert.equal(state.journal, null);
  assert.equal(state.active, false);
  assert.equal(
    (await read(join(firstRoot, "state.json"))).journal.key,
    "broken",
  );
  assert.equal((await f.request("status")).status, "error");
  assert.deepEqual((await f.poll(two.bundle)).packet, original);
  assert.equal((await f.poll(one.bundle, true)).packet, null);
});

test("repeated partial headers cannot exceed the per-source budget at enrollment recheck", async (t) => {
  const f = await context(t);
  const path = join(f.directory, "budget.jsonl");
  const complete = JSON.stringify({
    type: "session_meta",
    payload: {
      id: "budget",
      session_id: "budget",
      cli_version: "0.157.1",
      private: "x".repeat(64000),
    },
  });
  const partial = complete.slice(0, -3);
  await writeFile(path, partial, { mode: 0o600 });
  await f.activate();
  for (let i = 0; i < 30; i++) await f.action("directoryDiscover");
  await appendFile(path, `${complete.slice(-3)}\n`);
  const found = await f.action("directoryDiscover");
  assert.equal(found.reader.candidates.length, 1);
  assert.ok(found.reader.bytesRead < 2097152);
  assert.ok(found.reader.bytesRead + Buffer.byteLength(complete) + 1 > 2097152);
  const enrolled = await f.enroll(found.reader.candidates[0]);
  assert.equal(enrolled.result.reader.sources[0].status, "source_byte_limit");
  assert.equal(enrolled.result.reader.bytesRead, found.reader.bytesRead);
  assert.equal((await f.poll(enrolled.bundle)).packet, null);
});
