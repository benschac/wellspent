import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  connect,
  connection,
  createHarness,
  discover,
  logWork,
  openHarnessRoot,
  revoke,
  serve,
  validateInput,
} from "./harness-helper.mjs";
import { createConnectionBinding, stdio } from "./harness-mcp.mjs";
import { base64, bodyDigest, decode, sign, verify } from "./local-contract.mjs";
import { optional, publish, read } from "./local-helper.mjs";

// Exercise the actual SDK transport; only the test client frames JSON messages.
async function mcpSession(t, root) {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = createInterface({ input: output });
  lines.on("error", () => {}); // Failure fixtures also reach the SDK listener.
  const clientErrorListeners = output.listenerCount("error");
  const pending = new Map();
  const replies = new Map();
  lines.on("line", (line) => {
    const reply = JSON.parse(line);
    replies.set(reply.id, reply);
    pending.get(reply.id)?.(reply);
  });
  const server = await stdio(root, input, output);
  t.after(async () => {
    await server.close();
    lines.close();
    input.destroy();
    output.destroy();
  });
  const handle = async (message) => {
    if (!Object.hasOwn(message, "id")) {
      input.write(`${JSON.stringify(message)}\n`);
      await new Promise(setImmediate);
      return;
    }
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("MCP response timed out")),
        15000,
      );
      pending.set(message.id, (reply) => {
        clearTimeout(timeout);
        pending.delete(message.id);
        resolve(reply);
      });
    });
    input.write(`${JSON.stringify(message)}\n`);
    return response;
  };
  return Object.assign(handle, {
    send: (message) => input.write(`${JSON.stringify(message)}\n`),
    replies,
    input,
    output,
    clientErrorListeners,
    close: server.close,
  });
}

async function setup(t) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "wellspent-harness-test-"),
  );
  await chmod(root, 0o700);
  t.after(() => rm(root, { force: true, recursive: true }));
  await openHarnessRoot(root);
  const calls = [];
  let installed = [];
  const execute = async (command, args) => {
    calls.push({ command, args });
    if (args[1] === "list") return { stdout: JSON.stringify(installed) };
    installed = [
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
    return { stdout: "registered" };
  };
  const options = {
    scope: "local-fixture",
    codex: "/fixture/codex",
    node: process.execPath,
  };
  const saved = await connect(root, options, execute);
  const key = base64(saved.key, 32);
  const active = {
    recordingID: randomUUID(),
    intervalID: randomUUID(),
    localScopeID: saved.localScopeID,
  };
  const epoch = randomUUID();
  let now = new Date();
  const packet = (domain, body) =>
    sign(
      {
        version: 1,
        connectionID: saved.connectionID,
        nonce: randomUUID(),
        issuedAt: now.toISOString(),
        ...body,
      },
      key,
      domain,
    );
  const poll = (value = active) =>
    packet("harness-poll", { epoch, active: value });
  const note = (input = { id: randomUUID(), text: "Explicit fixture note" }) =>
    packet("harness-call", { ...input, reportedAt: now.toISOString() });
  const result = (request, status = "acknowledged") =>
    packet("harness-result", {
      eventID: decode(request).value.eventID,
      bodyDigest: bodyDigest(request),
      status,
      reason: status === "acknowledged" ? "committed" : "outside_interval",
      nativeReceivedAt: status === "acknowledged" ? now.toISOString() : null,
    });
  const dispatch = createHarness(root, () => now);
  return {
    root,
    calls,
    execute,
    options,
    saved,
    key,
    active,
    epoch,
    packet,
    poll,
    note,
    result,
    dispatch,
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
    restart: () => createHarness(root, () => now),
  };
}
const receipt = (f, id) => read(join(f.root, "receipts", `${id}.json`));
const requestPath = (f, id) => join(f.root, "requests", `${id}.json`);

test("installation uses supported credential-free args; unchanged repair preserves identity and discovery", async (t) => {
  const f = await setup(t);
  const add = f.calls.find((call) => call.args[1] === "add");
  assert.ok(add);
  assert.deepEqual(add.args.slice(0, 5), [
    "mcp",
    "add",
    "wellspent-local",
    "--",
    process.execPath,
  ]);
  assert.deepEqual(add.args.slice(-2), ["--root", f.root]);
  assert.equal(JSON.stringify(f.calls).includes(f.saved.key), false);
  assert.equal((await stat(join(f.root, "connection.json"))).mode & 0o077, 0);
  await discover(f.root);
  assert.equal(
    verify(
      await f.dispatch("/v1/harness/poll", f.poll()),
      f.key,
      "harness-response",
    ).discovered,
    true,
  );
  assert.deepEqual(await connect(f.root, f.options, f.execute), f.saved);
  assert.equal(
    verify(
      await f.dispatch("/v1/harness/poll", f.poll()),
      f.key,
      "harness-response",
    ).discovered,
    true,
  );
  assert.equal(f.calls.filter((call) => call.args[1] === "add").length, 1);
});
test("default Execa runner executes the Codex registration commands", async (t) => {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "wellspent-harness-execa-"),
  );
  await chmod(root, 0o700);
  t.after(() => rm(root, { force: true, recursive: true }));
  await openHarnessRoot(root);
  const codex = join(root, "fixture-codex");
  await writeFile(
    codex,
    `#!${process.execPath}\nif (process.argv.includes("list")) process.stdout.write("[]");\n`,
    { mode: 0o700 },
  );
  const saved = await connect(root, {
    scope: "local-execa-fixture",
    codex,
    node: process.execPath,
  });
  assert.equal((await connection(root)).connectionID, saved.connectionID);
  assert.equal((await read(join(root, "registration.json"))).installed, true);
});
test("same-name unrelated MCP registration is never overwritten", async (t) => {
  const f = await setup(t);
  let writes = 0;
  const execute = async (_command, args) => {
    if (args[1] !== "list") writes++;
    return {
      stdout: JSON.stringify([
        {
          name: "wellspent-local",
          transport: { type: "stdio", command: "/unrelated", args: [] },
        },
      ]),
    };
  };
  await assert.rejects(
    connect(f.root, f.options, execute),
    /mcp_name_conflict/,
  );
  assert.equal(writes, 0);
  assert.deepEqual(await connection(f.root), f.saved);
});
test("active note is persisted before poll, commit-before-receipt cleanup, duplicate stable and conflicting text rejected", async (t) => {
  const f = await setup(t);
  await f.dispatch("/v1/harness/poll", f.poll());
  const input = { id: randomUUID(), text: "Finished selected fixture" };
  await f.dispatch("/v1/harness/log", f.note(input));
  const saved = await read(requestPath(f, input.id));
  const body = verify(saved.packet, f.key, "harness-note");
  assert.equal(body.intervalID, f.active.intervalID);
  assert.equal(body.epoch, f.epoch);
  const queued = verify(
    await f.dispatch("/v1/harness/poll", f.poll()),
    f.key,
    "harness-response",
  ).request;
  assert.deepEqual(queued, saved.packet);
  assert.equal(
    await optional(join(f.root, "receipts", `${input.id}.json`)),
    null,
  );
  await f.dispatch("/v1/harness/result", f.result(queued));
  assert.equal((await receipt(f, input.id)).status, "acknowledged");
  assert.deepEqual(await readdir(join(f.root, "pending")), []);
  f.advance(1000);
  await f.dispatch("/v1/harness/log", f.note(input));
  assert.deepEqual(await read(requestPath(f, input.id)), saved);
  await assert.rejects(
    f.dispatch("/v1/harness/log", f.note({ ...input, text: "Different" })),
    /identity_conflict/,
  );
});
test("inactive and expired heartbeat attempts cannot be retroactively admitted", async (t) => {
  const f = await setup(t);
  const inactive = { id: randomUUID(), text: "Inactive" };
  await f.dispatch("/v1/harness/log", f.note(inactive));
  assert.equal((await receipt(f, inactive.id)).reason, "no_active_recording");
  await f.dispatch("/v1/harness/poll", f.poll());
  await f.dispatch("/v1/harness/log", f.note(inactive));
  assert.equal((await read(requestPath(f, inactive.id))).packet, null);
  f.advance(3001);
  const expired = { id: randomUUID(), text: "Expired heartbeat" };
  await f.dispatch("/v1/harness/log", f.note(expired));
  assert.equal((await receipt(f, expired.id)).status, "rejected");
  await f.dispatch("/v1/harness/poll", f.poll(null));
  const paused = { id: randomUUID(), text: "Paused" };
  await f.dispatch("/v1/harness/log", f.note(paused));
  assert.equal((await receipt(f, paused.id)).status, "rejected");
});
test("helper restart clears heartbeat and preserves pending body; signed poll replay remains rejected", async (t) => {
  const f = await setup(t);
  const poll = f.poll();
  await f.dispatch("/v1/harness/poll", poll);
  const input = { id: randomUUID(), text: "Before restart" };
  await f.dispatch("/v1/harness/log", f.note(input));
  const prior = await read(requestPath(f, input.id));
  const restarted = f.restart();
  await assert.rejects(restarted("/v1/harness/poll", poll), /replayed_request/);
  const inactive = { id: randomUUID(), text: "After restart before heartbeat" };
  await restarted("/v1/harness/log", f.note(inactive));
  assert.equal((await receipt(f, inactive.id)).status, "rejected");
  const pending = verify(
    await restarted("/v1/harness/poll", f.poll()),
    f.key,
    "harness-response",
  ).request;
  assert.deepEqual(pending, prior.packet);
  await restarted("/v1/harness/log", f.note(input));
  await restarted("/v1/harness/result", f.result(pending));
  assert.deepEqual(await read(requestPath(f, input.id)), prior);
  assert.equal((await receipt(f, input.id)).status, "acknowledged");
});
test("revocation rejects pending/new notes; explicit reconnect rotates credentials and retains evidence", async (t) => {
  const f = await setup(t);
  await f.dispatch("/v1/harness/poll", f.poll());
  const input = { id: randomUUID(), text: "Pending revocation" };
  await f.dispatch("/v1/harness/log", f.note(input));
  await revoke(f.root);
  assert.equal((await receipt(f, input.id)).reason, "connection_revoked");
  const next = { id: randomUUID(), text: "After revocation" };
  await f.dispatch("/v1/harness/log", f.note(next));
  assert.equal((await receipt(f, next.id)).reason, "connection_revoked");
  await assert.rejects(
    f.dispatch("/v1/harness/poll", f.poll()),
    /connection_revoked/,
  );
  const replacement = await connect(f.root, f.options, f.execute);
  assert.notEqual(replacement.connectionID, f.saved.connectionID);
  assert.notEqual(replacement.key, f.saved.key);
  assert.equal(replacement.endpoint, f.saved.endpoint);
  assert.equal((await receipt(f, input.id)).status, "rejected");
  assert.equal(
    (await read(requestPath(f, input.id))).connectionID,
    f.saved.connectionID,
  );
  await assert.rejects(
    f.dispatch("/v1/harness/poll", f.poll()),
    /untrustedSender/,
  );
});
test("bad signatures, stale requests, wrong scope, wrong digest and invalid inputs cannot commit", async (t) => {
  const f = await setup(t);
  const valid = f.poll();
  await assert.rejects(
    f.dispatch("/v1/harness/poll", {
      ...valid,
      mac: Buffer.alloc(32).toString("base64"),
    }),
    /untrustedSender/,
  );
  f.advance(15001);
  await assert.rejects(
    f.dispatch("/v1/harness/poll", valid),
    /invalid_request/,
  );
  await assert.rejects(
    f.dispatch(
      "/v1/harness/poll",
      f.poll({ ...f.active, localScopeID: "other" }),
    ),
    /invalid_active_interval/,
  );
  await f.dispatch("/v1/harness/poll", f.poll());
  const input = { id: randomUUID(), text: "Valid" };
  await f.dispatch("/v1/harness/log", f.note(input));
  const stored = await read(requestPath(f, input.id));
  const forged = f.packet("harness-result", {
    ...decode(f.result(stored.packet)).value,
    nonce: randomUUID(),
    bodyDigest: "0".repeat(64),
  });
  await assert.rejects(
    f.dispatch("/v1/harness/result", forged),
    /identity_conflict/,
  );
  assert.equal(
    await optional(join(f.root, "receipts", `${input.id}.json`)),
    null,
  );
  for (const value of [
    { text: "Missing identity" },
    { id: randomUUID(), text: " " },
    { id: randomUUID(), text: "x".repeat(4097) },
    { id: randomUUID(), text: "✓".repeat(1400) },
    { id: randomUUID(), text: "ok", extra: true },
  ])
    assert.throws(() => validateInput(value), /invalid_note/);
});
test("real HTTP MCP call waits for native ACK; unavailable helper rejection stays terminal", async (t) => {
  const f = await setup(t);
  const server = await serve(f.root);
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  async function http(route, packet) {
    const response = await fetch(`${f.saved.endpoint}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(packet),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  await http("/v1/harness/poll", f.poll());
  const input = { id: randomUUID(), text: "HTTP acknowledgement" };
  const waiting = logWork(f.root, input, { waitMs: 1000 });
  let pending;
  for (let i = 0; i < 50 && !pending; i++) {
    pending = verify(
      await http("/v1/harness/poll", f.poll()),
      f.key,
      "harness-response",
    ).request;
    if (!pending) await new Promise((done) => setTimeout(done, 10));
  }
  assert.ok(pending);
  await http("/v1/harness/result", f.result(pending));
  assert.equal((await waiting).status, "acknowledged");
  assert.equal(
    (await logWork(f.root, input, { waitMs: 1 })).status,
    "acknowledged",
  );
  const unconfirmed = { id: randomUUID(), text: "No native receipt yet" };
  assert.equal(
    (await logWork(f.root, unconfirmed, { waitMs: 1 })).status,
    "unconfirmed",
  );
  await new Promise((done) => {
    server.close(done);
    server.closeAllConnections();
  });
  const offline = { id: randomUUID(), text: "Offline attempt" };
  assert.equal(
    (await logWork(f.root, offline, { waitMs: 1 })).status,
    "rejected",
  );
  assert.equal((await read(requestPath(f, offline.id))).packet, null);
});
test("one MCP session follows pause, resume and a new recording without rediscovery", async (t) => {
  const f = await setup(t);
  const server = await serve(f.root);
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const handle = await mcpSession(t, f.root);
  await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "persistent-session", version: "1" },
    },
  });
  await handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  let rpcID = 2;
  const call = (input) =>
    handle({
      jsonrpc: "2.0",
      id: ++rpcID,
      method: "tools/call",
      params: { name: "log_work", arguments: input },
    });
  async function http(route, packet) {
    const response = await fetch(`${f.saved.endpoint}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(packet),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function save(active, status = "acknowledged") {
    await http("/v1/harness/poll", f.poll(active));
    const waiting = call({ id: randomUUID(), text: "Note in this interval" });
    let pending;
    for (let i = 0; i < 100 && !pending; i++) {
      const polled = verify(
        await http("/v1/harness/poll", f.poll(active)),
        f.key,
        "harness-response",
      );
      assert.equal(polled.discovered, true);
      pending = polled.request;
      if (!pending) await new Promise((done) => setTimeout(done, 10));
    }
    assert.ok(pending);
    const note = decode(pending).value;
    assert.equal(note.recordingID, active.recordingID);
    assert.equal(note.intervalID, active.intervalID);
    await http("/v1/harness/result", f.result(pending, status));
    assert.equal((await waiting).result.isError, status !== "acknowledged");
  }
  await save(f.active);
  await save(f.active, "rejected");
  await http("/v1/harness/poll", f.poll(null));
  const paused = { id: randomUUID(), text: "Excluded while paused" };
  assert.equal((await call(paused)).result.isError, true);
  await save({ ...f.active, intervalID: randomUUID() });
  assert.equal((await call(paused)).result.isError, true);
  await http("/v1/harness/poll", f.poll(null));
  await save({
    ...f.active,
    recordingID: randomUUID(),
    intervalID: randomUUID(),
  });
  assert.equal((await connection(f.root)).connectionID, f.saved.connectionID);
});
test("MCP discovery and rejected tool calls use non-success, bounded stdio subprocess speaks JSON only", async (t) => {
  const f = await setup(t);
  const handle = await mcpSession(t, f.root);
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "fixture", version: "1" },
    },
  };
  assert.equal((await handle(init)).result.serverInfo.name, "wellspent-local");
  await handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(
    (await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result.tools
      .length,
    1,
  );
  const reply = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "log_work",
      arguments: { id: randomUUID(), text: "App offline" },
    },
  });
  assert.equal(reply.result.isError, true);
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./harness-mcp.mjs", import.meta.url)),
      "--root",
      f.root,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(
    `${[init, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }].map(JSON.stringify).join("\n")}\n`,
  );
  assert.equal(await new Promise((done) => child.once("close", done)), 0);
  assert.equal(stderr, "");
  const replies = stdout.trim().split("\n").map(JSON.parse);
  assert.equal(replies.length, 2);
  assert.equal(replies[1].result.tools[0].name, "log_work");
  assert.equal(stdout.includes(f.saved.key), false);
});
test("orphaned committed receipt wins over pending file after restart", async (t) => {
  const f = await setup(t);
  await f.dispatch("/v1/harness/poll", f.poll());
  const input = {
    id: randomUUID(),
    text: "Crash between receipt and pending cleanup",
  };
  await f.dispatch("/v1/harness/log", f.note(input));
  await publish(join(f.root, "receipts", `${input.id}.json`), {
    status: "acknowledged",
    reason: "committed",
    nativeReceivedAt: new Date().toISOString(),
  });
  const reply = verify(
    await f.restart()("/v1/harness/poll", f.poll()),
    f.key,
    "harness-response",
  );
  assert.equal(reply.request, null);
  assert.equal((await receipt(f, input.id)).status, "acknowledged");
});
test("revoked and reconnected identities cannot return old ACKs or rediscover from an old MCP session", async (t) => {
  const f = await setup(t);
  const handle = await mcpSession(t, f.root);
  await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "fixture", version: "1" },
    },
  });
  await handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  await f.dispatch("/v1/harness/poll", f.poll());
  const input = { id: randomUUID(), text: "Previously committed" };
  await f.dispatch("/v1/harness/log", f.note(input));
  const original = await read(requestPath(f, input.id));
  await f.dispatch("/v1/harness/result", f.result(original.packet));
  await revoke(f.root);
  assert.equal((await logWork(f.root, input)).reason, "connection_revoked");
  await connect(f.root, f.options, f.execute);
  assert.equal((await logWork(f.root, input)).reason, "connection_changed");
  assert.equal((await receipt(f, input.id)).status, "acknowledged");
  assert.equal(
    (await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })).error.code,
    -32603,
  );
});
test("repair safely replaces previously registered executable and registration failure can be repaired", async (t) => {
  const f = await setup(t);
  await discover(f.root);
  const updated = { ...f.options, node: "/updated/node" };
  assert.deepEqual(await connect(f.root, updated, f.execute), f.saved);
  assert.equal(await optional(join(f.root, "discovered.json")), null);
  assert.equal(f.calls.filter((call) => call.args[1] === "add").length, 2);
  assert.equal(
    (await read(join(f.root, "registration.json"))).command,
    "/updated/node",
  );
  let fail = true;
  const execute = async (command, args, options) => {
    if (args[1] === "add" && fail) throw new Error("fixture_install_failure");
    return f.execute(command, args, options);
  };
  await assert.rejects(
    connect(f.root, f.options, execute),
    /fixture_install_failure/,
  );
  assert.equal(
    (await read(join(f.root, "registration.json"))).installed,
    false,
  );
  fail = false;
  assert.deepEqual(await connect(f.root, f.options, execute), f.saved);
  assert.equal((await read(join(f.root, "registration.json"))).installed, true);
});
test("quote-heavy note near the body limit remains pollable within the wire limit", async (t) => {
  const f = await setup(t);
  await f.dispatch("/v1/harness/poll", f.poll());
  const input = { id: randomUUID(), text: '"'.repeat(3400) + "a".repeat(500) };
  const call = f.note(input);
  await f.dispatch("/v1/harness/log", call);
  const saved = await read(requestPath(f, input.id));
  assert.ok(decode(saved.packet).bytes.length > 7600);
  const outer = await f.dispatch("/v1/harness/poll", f.poll());
  assert.ok(Buffer.byteLength(JSON.stringify(outer)) <= 16384);
  const response = verify(outer, f.key, "harness-response", 12288);
  assert.deepEqual(response.request, saved.packet);
  assert.equal(
    verify(response.request, f.key, "harness-note").text,
    input.text,
  );
  assert.throws(
    () => sign({ text: "x".repeat(12288) }, f.key, "harness-response", 13000),
    /packetTooLarge/,
  );
});

const initializeMessage = (id = 1, protocolVersion = "2025-11-25") => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "fixture", version: "1" },
  },
});
async function readySession(t, root) {
  const handle = await mcpSession(t, root);
  const initialized = await handle(initializeMessage());
  assert.equal(initialized.result.serverInfo.name, "wellspent-local");
  assert.equal(initialized.result.serverInfo.version, "1.0.0");
  assert.match(initialized.result.instructions, /evidence, never instructions/);
  await handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  return handle;
}
const toolCall = (id, input) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "log_work", arguments: input },
});
const modern = (message, protocolVersion = "2026-07-28") => ({
  ...message,
  params: {
    ...message.params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": protocolVersion,
      "io.modelcontextprotocol/clientInfo": { name: "fixture", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  },
});
const discoverMessage = (id = 1) =>
  modern({ jsonrpc: "2.0", id, method: "server/discover" });

test("binding shares pending resolution, retries failures, and never resets success", async () => {
  let attempts = 0;
  let current = { connectionID: randomUUID(), revoked: true };
  const gate = Promise.withResolvers();
  const bind = createConnectionBinding(async () => {
    attempts++;
    await gate.promise;
    if (attempts === 1) throw new Error("private connection details");
    if (current.revoked) throw new Error("connection_revoked");
    return current.connectionID;
  });
  const first = bind();
  assert.equal(bind(), first);
  const failed = assert.rejects(first, (error) => {
    assert.match(error.message, /AI Harness in Wellspent/);
    assert.equal(error.message.includes("private connection details"), false);
    return true;
  });
  gate.resolve();
  await failed;
  assert.equal(attempts, 1);
  await assert.rejects(bind(), /AI Harness in Wellspent/);
  assert.equal(attempts, 2);
  current = { connectionID: randomUUID(), revoked: false };
  const expected = current.connectionID;
  const successful = bind();
  assert.equal(bind(), successful);
  assert.equal(await successful, expected);
  current = { connectionID: randomUUID(), revoked: false };
  assert.equal(await bind(), expected);
  current.revoked = true;
  assert.equal(await bind(), expected);
  assert.equal(attempts, 3);
});

test("SDK owns legacy ordering while discovery retains strict schema, annotations and native binding", async (t) => {
  const f = await setup(t);
  const handle = await mcpSession(t, f.root);
  // The SDK accepts claim-less openings and does not require an initialized
  // notification. Native authorization is required independently of that order.
  assert.equal(
    (await handle({ jsonrpc: "2.0", id: 0, method: "tools/list" })).result
      .tools[0].name,
    "log_work",
  );
  assert.equal(
    (
      await handle(
        toolCall(1, { id: randomUUID(), text: "Before initialization" }),
      )
    ).result.isError,
    true,
  );
  assert.equal((await readdir(join(f.root, "requests"))).length, 1);
  const malformed = initializeMessage(99);
  malformed.params.clientInfo = {};
  assert.ok((await handle(malformed)).error);
  const init = await handle(initializeMessage(2, "unknown-version"));
  assert.equal(init.result.protocolVersion, "2025-11-25");
  assert.ok(
    (await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" })).result,
  );
  await handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  const { result } = await handle({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/list",
  });
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].name, "log_work");
  assert.equal(result.tools[0].inputSchema.additionalProperties, false);
  assert.equal(result.tools[0].inputSchema.properties.id.format, "uuid");
  assert.deepEqual(result.tools[0].inputSchema.required, ["id", "text"]);
  assert.deepEqual(result.tools[0].annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.ok((await handle(initializeMessage(5))).result);
});

test("SDK modern negotiation and direct opening preserve the native tools/list gate", async (t) => {
  for (const probe of [true, false]) {
    const f = await setup(t);
    const handle = await mcpSession(t, f.root);
    if (probe) {
      const discovery = await handle(discoverMessage());
      assert.deepEqual(discovery.result.supportedVersions, ["2026-07-28"]);
      assert.equal(
        discovery.result._meta["io.modelcontextprotocol/serverInfo"].name,
        "wellspent-local",
      );
      // Protocol discovery must not publish the native tool-discovery marker.
      assert.equal(await optional(join(f.root, "discovered.json")), null);
    }
    const list = modern({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const listed = await handle(list);
    assert.equal(listed.result.tools[0].name, "log_work");
    assert.equal(
      (await read(join(f.root, "discovered.json"))).connectionID,
      f.saved.connectionID,
    );
    const input = { id: randomUUID(), text: "Modern explicit note" };
    const reply = await handle(modern(toolCall(3, input)));
    assert.equal(reply.result.isError, true);
    assert.equal(
      JSON.parse(reply.result.content[0].text).reason,
      "helper_unavailable",
    );
    assert.ok((await handle(initializeMessage(4))).error);
    await revoke(f.root);
    assert.ok((await handle({ ...list, id: 5 })).error);
    await connect(f.root, f.options, f.execute);
    assert.ok((await handle({ ...list, id: 6 })).error);
    const replaced = await handle(modern(toolCall(7, input)));
    assert.equal(
      JSON.parse(replaced.result.content[0].text).reason,
      "connection_changed",
    );
  }
});

test("SDK probe fallback retains the first native identity and cannot follow reconnection", async (t) => {
  const f = await setup(t);
  const handle = await mcpSession(t, f.root);
  assert.ok((await handle(discoverMessage())).result);
  assert.ok((await handle(discoverMessage(2))).result);
  await revoke(f.root);
  const replacement = await connect(f.root, f.options, f.execute);
  assert.notEqual(replacement.connectionID, f.saved.connectionID);
  // serveStdio discards the modern probe and calls our factory again here.
  assert.ok((await handle(initializeMessage(3))).result);
  await handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.ok(
    (await handle({ jsonrpc: "2.0", id: 4, method: "tools/list" })).error,
  );
  assert.equal(await optional(join(f.root, "discovered.json")), null);
  const reply = await handle(
    toolCall(5, { id: randomUUID(), text: "Old session" }),
  );
  assert.equal(reply.result.isError, true);
  assert.equal(
    JSON.parse(reply.result.content[0].text).reason,
    "connection_changed",
  );
  assert.deepEqual(await readdir(join(f.root, "requests")), []);
  const fresh = await readySession(t, f.root);
  assert.ok(
    (await fresh({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result,
  );
});

test("SDK probe fallback and concurrent opening requests share a usable binding", async (t) => {
  const f = await setup(t);
  const handle = await mcpSession(t, f.root);
  const replies = await Promise.all([
    handle(discoverMessage()),
    handle(initializeMessage(2)),
    handle({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
  ]);
  assert.deepEqual(replies[0].result.supportedVersions, ["2026-07-28"]);
  assert.equal(replies[1].result.serverInfo.name, "wellspent-local");
  assert.equal(replies[2].result.tools[0].name, "log_work");
  assert.equal(
    (await read(join(f.root, "discovered.json"))).connectionID,
    f.saved.connectionID,
  );
});

test("SDK failed discovery can recover before binding, including a legacy fallback", async (t) => {
  const f = await setup(t);
  const handle = await mcpSession(t, f.root);
  await revoke(f.root);
  const failed = await handle(discoverMessage());
  assert.deepEqual(failed.error, {
    code: -32603,
    message: "Internal server error",
  });
  await connect(f.root, f.options, f.execute);
  assert.ok((await handle(initializeMessage(2))).result);
  assert.ok(
    (await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" })).result,
  );
});

test("SDK modern calls preserve durable success and cannot return old ACKs after replacement", async (t) => {
  const f = await setup(t);
  const handle = await mcpSession(t, f.root);
  assert.ok((await handle(discoverMessage())).result);
  await f.dispatch("/v1/harness/poll", f.poll());
  const input = { id: randomUUID(), text: "Committed modern note" };
  await f.dispatch("/v1/harness/log", f.note(input));
  const original = await read(requestPath(f, input.id));
  await f.dispatch("/v1/harness/result", f.result(original.packet));
  const saved = await receipt(f, input.id);
  const acknowledged = await handle(modern(toolCall(2, input)));
  assert.equal(acknowledged.result.isError, false);
  assert.deepEqual(acknowledged.result.content, [
    {
      type: "text",
      text: JSON.stringify({
        id: input.id,
        status: saved.status,
        reason: saved.reason,
        nativeReceivedAt: saved.nativeReceivedAt,
      }),
    },
  ]);
  await revoke(f.root);
  assert.equal((await handle(modern(toolCall(3, input)))).result.isError, true);
  await connect(f.root, f.options, f.execute);
  const replaced = await handle(modern(toolCall(4, input)));
  assert.equal(replaced.result.isError, true);
  assert.equal(
    JSON.parse(replaced.result.content[0].text).reason,
    "connection_changed",
  );
  assert.deepEqual(await receipt(f, input.id), saved);
});

test("SDK lifecycle handle closes opening, probe and pinned transports idempotently", async (t) => {
  const f = await setup(t);
  for (const opening of [
    null,
    discoverMessage(),
    initializeMessage(),
    modern(toolCall(1, { id: randomUUID(), text: "Close fixture" })),
  ]) {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = createInterface({ input: output });
    const clientErrorListeners = output.listenerCount("error");
    const server = stdio(f.root, input, output);
    try {
      if (opening) {
        const response = new Promise((resolve) => lines.once("line", resolve));
        input.write(`${JSON.stringify(opening)}\n`);
        assert.ok(JSON.parse(await response).result);
      }
      await server.close();
      await server.close();
      assert.equal(input.listenerCount("data"), 0);
      assert.equal(input.listenerCount("error"), 0);
      assert.equal(output.listenerCount("error"), clientErrorListeners);
    } finally {
      await server.close();
      lines.close();
      input.destroy();
      output.destroy();
    }
  }
});

test("SDK input validation rejects malformed notes before persistence and preserves UTF-8 byte boundaries", async (t) => {
  const f = await setup(t);
  const handle = await readySession(t, f.root);
  let rpcID = 2;
  for (const input of [
    { id: "not-a-uuid", text: "note" },
    { text: "missing id" },
    { id: randomUUID(), text: "" },
    { id: randomUUID(), text: " \n\t" },
    { id: randomUUID(), text: "note", extra: true },
    { id: randomUUID(), text: "a".repeat(4097) },
    { id: randomUUID(), text: `${"😀".repeat(1024)}a` },
    { id: randomUUID(), text: "é".repeat(2049) },
    { id: randomUUID(), text: "\ud800" },
    { id: randomUUID(), text: "\udc00" },
    { id: randomUUID(), text: 123 },
  ]) {
    const reply = await handle(toolCall(rpcID++, input));
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /Input validation error/);
  }
  assert.ok((await handle(toolCall(rpcID++, null))).error);
  assert.deepEqual(await readdir(join(f.root, "requests")), []);
  for (const text of [
    "a".repeat(4095),
    "a".repeat(4096),
    `${"😀".repeat(1023)}abc`,
    "😀".repeat(1024),
    "é".repeat(2048),
  ]) {
    const id = randomUUID().toUpperCase();
    const reply = await handle(toolCall(rpcID++, { id, text }));
    // An offline app is a terminal rejection, proving validation reached the helper.
    const status = JSON.parse(reply.result.content[0].text);
    assert.equal(status.id, id.toLowerCase());
    assert.equal(status.reason, "helper_unavailable");
    assert.equal(reply.result.isError, true);
    assert.equal((await read(requestPath(f, id.toLowerCase()))).packet, null);
  }
});

test("SDK factory binds once and rejects missing, revoked and replaced connections without returning old ACKs", async (t) => {
  const f = await setup(t);
  const beforeBinding = await mcpSession(t, f.root);
  await revoke(f.root);
  assert.match(
    (await beforeBinding(initializeMessage())).error.message,
    /Internal server error/,
  );
  const replacement = await connect(f.root, f.options, f.execute);
  // A failed initialization is repairable; a successful one cannot rebind.
  assert.ok((await beforeBinding(initializeMessage(2))).result);
  await beforeBinding({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.ok(
    (await beforeBinding({ jsonrpc: "2.0", id: 3, method: "tools/list" }))
      .result,
  );
  assert.equal(
    (await read(join(f.root, "discovered.json"))).connectionID,
    replacement.connectionID,
  );
  await revoke(f.root);
  const input = { id: randomUUID(), text: "Revoked" };
  const revoked = await beforeBinding(toolCall(4, input));
  assert.equal(revoked.result.isError, true);
  assert.match(revoked.result.content[1].text, /AI Harness in Wellspent/);
  await connect(f.root, f.options, f.execute);
  const replaced = await beforeBinding(toolCall(5, input));
  assert.equal(replaced.result.isError, true);
  assert.equal(
    JSON.parse(replaced.result.content[0].text).reason,
    "connection_changed",
  );
  // Reinitialization belongs to the SDK and cannot change the native binding.
  assert.ok((await beforeBinding(initializeMessage(6))).result);
  assert.ok(
    (await beforeBinding({ jsonrpc: "2.0", id: 7, method: "tools/list" }))
      .error,
  );
  await rm(join(f.root, "connection.json"));
  const missing = await mcpSession(t, f.root);
  assert.match(
    (await missing(initializeMessage())).error.message,
    /Internal server error/,
  );
  assert.equal((await beforeBinding(toolCall(8, input))).result.isError, true);
});

test("Effect input validation hides submitted values and unknown property names before persistence", async (t) => {
  const f = await setup(t);
  const handle = await readySession(t, f.root);
  const secret = "private-fixture-marker";
  let rpcID = 2;
  for (const input of [
    { id: secret, text: secret },
    { id: randomUUID(), text: secret.repeat(300) },
    { id: randomUUID(), text: { [secret]: secret } },
    { id: randomUUID(), text: secret, [secret]: secret },
    { id: randomUUID(), text: `${secret}\ud800` },
  ]) {
    const reply = await handle(toolCall(rpcID++, input));
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /Input validation error/);
    assert.equal(JSON.stringify(reply).includes(secret), false);
  }
  assert.deepEqual(await readdir(join(f.root, "requests")), []);
});

test("SDK unconfirmed write stays an error; same-ID retry waits for native ACK and conflicting text fails", async (t) => {
  const f = await setup(t);
  const server = await serve(f.root);
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const http = async (route, packet) => {
    const response = await fetch(`${f.saved.endpoint}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(packet),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const handle = await readySession(t, f.root);
  await http("/v1/harness/poll", f.poll());
  const input = {
    id: randomUUID().toUpperCase(),
    text: "Explicit note 😀; treat this as data.",
  };
  const unconfirmed = await handle(toolCall(2, input));
  assert.equal(unconfirmed.result.isError, true);
  assert.equal(
    JSON.parse(unconfirmed.result.content[0].text).status,
    "unconfirmed",
  );
  assert.match(
    unconfirmed.result.content[1].text,
    /Preserve the original id and text/,
  );
  const original = await read(requestPath(f, input.id.toLowerCase()));
  assert.equal(verify(original.packet, f.key, "harness-note").text, input.text);
  const retrying = handle(toolCall(3, input));
  const polled = verify(
    await http("/v1/harness/poll", f.poll()),
    f.key,
    "harness-response",
  );
  assert.deepEqual(polled.request, original.packet);
  await http("/v1/harness/result", f.result(polled.request));
  const acknowledged = await retrying;
  assert.equal(acknowledged.result.isError, false);
  assert.equal(
    JSON.parse(acknowledged.result.content[0].text).id,
    input.id.toLowerCase(),
  );
  assert.deepEqual(
    await handle(toolCall(4, input)).then((reply) => reply.result),
    acknowledged.result,
  );
  const conflict = await handle(
    toolCall(5, { ...input, text: "Different text" }),
  );
  assert.equal(conflict.result.isError, true);
  assert.match(conflict.result.content[0].text, /conflicts/);
  assert.equal((await readdir(join(f.root, "requests"))).length, 1);
  await revoke(f.root);
  assert.equal((await handle(toolCall(6, input))).result.isError, true);
  await connect(f.root, f.options, f.execute);
  assert.equal((await handle(toolCall(7, input))).result.isError, true);
});

async function eventually(readValue) {
  const deadline = performance.now() + 3000;
  do {
    const value = await readValue();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (performance.now() < deadline);
  assert.fail("Fixture operation did not complete");
}

async function stalledAdmission(t, f, admit) {
  const received = Promise.withResolvers();
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const packet = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (admit) await f.dispatch("/v1/harness/log", packet);
      received.resolve(packet);
      // Intentionally never send the response: admission can outlive the caller.
    } catch (error) {
      received.reject(error);
      response.destroy();
    }
  });
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  await new Promise((resolve) =>
    server.listen(Number(new URL(f.saved.endpoint).port), "127.0.0.1", resolve),
  );
  return { received: received.promise };
}

test("pre-aborted native attempt preserves a terminal identity before cancellation completes", async (t) => {
  const f = await setup(t);
  const input = { id: randomUUID(), text: "Cancelled before fetch" };
  await assert.rejects(
    logWork(f.root, input, { signal: AbortSignal.abort() }),
    { name: "AbortError" },
  );
  const original = await read(requestPath(f, input.id));
  assert.equal(original.packet, null);
  assert.equal((await receipt(f, input.id)).reason, "helper_unavailable");
  await f.dispatch("/v1/harness/poll", f.poll());
  await f.dispatch("/v1/harness/log", f.note(input));
  assert.deepEqual(await read(requestPath(f, input.id)), original);
  assert.equal((await logWork(f.root, input)).status, "rejected");
  await assert.rejects(
    logWork(f.root, { ...input, text: "Changed" }),
    /identity_conflict/,
  );
  assert.deepEqual(await readdir(join(f.root, "pending")), []);
});

test("HTTP cancellation preserves both unadmitted and admitted identities across a lost response", async (t) => {
  for (const admit of [false, true]) {
    await t.test(admit ? "admitted" : "before admission", async (t) => {
      const f = await setup(t);
      await f.dispatch("/v1/harness/poll", f.poll());
      const { received } = await stalledAdmission(t, f, admit);
      const input = { id: randomUUID(), text: "Private cancellation fixture" };
      const controller = new AbortController();
      const cancelled = assert.rejects(
        logWork(f.root, input, { signal: controller.signal }),
        { name: "AbortError" },
      );
      const packet = await received;
      controller.abort();
      await cancelled;
      const original = await read(requestPath(f, input.id));
      if (admit) {
        assert.ok(original.packet);
        assert.equal(
          await optional(join(f.root, "receipts", `${input.id}.json`)),
          null,
        );
        await f.dispatch("/v1/harness/result", f.result(original.packet));
        assert.equal((await logWork(f.root, input)).status, "acknowledged");
      } else {
        assert.equal(original.packet, null);
        // A server that processes the packet after cancellation cannot admit it.
        await f.dispatch("/v1/harness/log", packet);
        assert.equal(
          (await logWork(f.root, input)).reason,
          "helper_unavailable",
        );
      }
      assert.deepEqual(await read(requestPath(f, input.id)), original);
      assert.equal((await readdir(join(f.root, "requests"))).length, 1);
      assert.deepEqual(await readdir(join(f.root, "pending")), []);
    });
  }
});

test("stalled HTTP retains the three-second budget and an admitted write remains recoverable", async (t) => {
  const f = await setup(t);
  await f.dispatch("/v1/harness/poll", f.poll());
  const { received } = await stalledAdmission(t, f, true);
  const input = { id: randomUUID(), text: "Timeout after admission" };
  const start = performance.now();
  const waiting = logWork(f.root, input, { waitMs: 1 });
  await received;
  assert.equal((await waiting).status, "unconfirmed");
  const elapsed = performance.now() - start;
  assert.ok(elapsed >= 2900 && elapsed < 6000, `elapsed=${elapsed}`);
  const original = await read(requestPath(f, input.id));
  await f.dispatch("/v1/harness/result", f.result(original.packet));
  assert.equal((await logWork(f.root, input)).status, "acknowledged");
});

test("SDK cancellation during acknowledgement waiting suppresses the response and permits a same-ID ACK retry", async (t) => {
  const f = await setup(t);
  const server = await serve(f.root);
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  const http = async (route, packet) => {
    const response = await fetch(`${f.saved.endpoint}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(packet),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  await http("/v1/harness/poll", f.poll());
  const handle = await readySession(t, f.root);
  const input = { id: randomUUID(), text: "Private SDK cancellation" };
  handle.send(toolCall(10, input));
  const original = await eventually(() => optional(requestPath(f, input.id)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  await handle({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 10, reason: "private abort reason" },
  });
  await handle({ jsonrpc: "2.0", id: 11, method: "ping" });
  assert.equal(handle.replies.has(10), false);
  assert.ok(original.packet);
  await http("/v1/harness/result", f.result(original.packet));
  const retry = await handle(toolCall(12, input));
  assert.equal(retry.result.isError, false);
  assert.equal(JSON.parse(retry.result.content[0].text).status, "acknowledged");
  await handle.close();
  assert.equal(handle.replies.has(10), false);
  assert.deepEqual(await read(requestPath(f, input.id)), original);
  assert.equal((await readdir(join(f.root, "requests"))).length, 1);
});

test("stdio close, EOF and stream failures interrupt admitted work and release listeners", async (t) => {
  for (const mode of [
    "close",
    "EOF",
    "input error",
    "output error",
    "output close",
  ]) {
    await t.test(mode, async (t) => {
      const f = await setup(t);
      const server = await serve(f.root);
      t.after(() => {
        server.close();
        server.closeAllConnections();
      });
      const poll = await fetch(`${f.saved.endpoint}/v1/harness/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(f.poll()),
      });
      assert.equal(poll.status, 200);
      await poll.arrayBuffer();
      const handle = await readySession(t, f.root);
      const input = {
        id: randomUUID(),
        text: "Shutdown leaves this recoverable",
      };
      handle.send(toolCall(10, input));
      const original = await eventually(() =>
        optional(requestPath(f, input.id)),
      );
      const start = performance.now();
      if (mode === "close") await handle.close();
      else if (mode === "EOF") handle.input.end();
      else if (mode === "input error")
        handle.input.emit("error", new Error("private input failure"));
      else if (mode === "output error")
        handle.output.emit("error", new Error("private output failure"));
      else handle.output.destroy();
      await eventually(() => handle.input.listenerCount("data") === 0);
      await handle.close();
      assert.ok(performance.now() - start < 3000);
      assert.equal(handle.input.listenerCount("end"), 0);
      assert.equal(handle.input.listenerCount("close"), 0);
      assert.equal(handle.input.listenerCount("error"), 0);
      assert.ok(
        handle.output.listenerCount("error") <= handle.clientErrorListeners,
      );
      assert.equal(handle.replies.has(10), false);
      assert.ok(original.packet);
      assert.deepEqual(await read(requestPath(f, input.id)), original);
      assert.ok(await optional(join(f.root, "pending", `${input.id}.json`)));
      assert.equal(
        await optional(join(f.root, "receipts", `${input.id}.json`)),
        null,
      );
    });
  }
});

async function runMcpCli(t, entry, args, chunks, env = process.env) {
  const child = spawn(process.execPath, [entry, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.on("error", () => {}); // Invalid CLI arguments can exit before input is sent.
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  for (const chunk of chunks) {
    child.stdin.write(chunk);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  child.stdin.end();
  return { code: await closed, stdout, stderr };
}
const mcpEntry = fileURLToPath(new URL("./harness-mcp.mjs", import.meta.url));

test("opt-in tracing stays on stderr and excludes notes, credentials, roots and arbitrary validation fields", async (t) => {
  const f = await setup(t);
  const privateText = "private diagnostic canary";
  const input = { id: randomUUID(), text: privateText };
  const result = await runMcpCli(
    t,
    mcpEntry,
    ["--root", f.root],
    [
      `${[
        initializeMessage(),
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        toolCall(3, input),
        toolCall(4, { ...input, [privateText]: f.saved.key }),
      ]
        .map(JSON.stringify)
        .join("\n")}\n`,
    ],
    { ...process.env, WELLSPENT_HARNESS_TRACE: "1" },
  );
  assert.equal(result.code, 0);
  const replies = result.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(replies.length, 4);
  assert.ok(replies.every((reply) => reply.jsonrpc === "2.0"));
  const records = result.stderr.trim().split("\n").map(JSON.parse);
  for (const name of [
    "mcp.log_work",
    "harness.log_work",
    "harness.discover",
    "harness.native",
  ]) {
    assert.ok(
      records.some((record) => record.span === name),
      name,
    );
  }
  assert.ok(
    records.some((record) => record.errorTag === "ConnectionUnavailable"),
  );
  for (const secret of [
    privateText,
    f.saved.key,
    f.root,
    f.saved.endpoint,
    f.saved.connectionID,
  ]) {
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);
  }
  assert.equal(result.stderr.includes(input.id), false);
  for (const record of records) {
    assert.ok(
      Object.keys(record).every((key) =>
        ["span", "durationMs", "status", "errorTag"].includes(key),
      ),
    );
  }
});

test("CLI EOF and SIGTERM stop stalled HTTP only after durable rejection bookkeeping", async (t) => {
  for (const mode of ["EOF", "SIGTERM"]) {
    await t.test(mode, async (t) => {
      const f = await setup(t);
      const { received } = await stalledAdmission(t, f, false);
      const input = { id: randomUUID(), text: "Private shutdown canary" };
      const child = spawn(process.execPath, [mcpEntry, "--root", f.root], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      t.after(() => child.kill());
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      const closed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      child.stdin.write(
        `${[
          initializeMessage(),
          { jsonrpc: "2.0", method: "notifications/initialized" },
          toolCall(2, input),
        ]
          .map(JSON.stringify)
          .join("\n")}\n`,
      );
      await received;
      const start = performance.now();
      if (mode === "EOF") child.stdin.end();
      else child.kill("SIGTERM");
      assert.deepEqual(await closed, { code: 0, signal: null });
      assert.ok(performance.now() - start < 2500);
      assert.equal(stderr, "");
      assert.equal(stdout.includes(input.text), false);
      assert.ok(
        stdout
          .trim()
          .split("\n")
          .map(JSON.parse)
          .every((reply) => reply.id !== 2),
      );
      assert.equal((await receipt(f, input.id)).reason, "helper_unavailable");
      const original = await read(requestPath(f, input.id));
      assert.equal(original.packet, null);
      await f.dispatch("/v1/harness/poll", f.poll());
      await f.dispatch("/v1/harness/log", f.note(input));
      assert.deepEqual(await read(requestPath(f, input.id)), original);
    });
  }
});

test("CLI --root and SDK framing handle coalesced lines and split Unicode without stdout diagnostics", async (t) => {
  const f = await setup(t);
  const input = { id: randomUUID(), text: "Explicit 😀 note" };
  const bytes = Buffer.from(
    `${[
      initializeMessage(),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      toolCall(3, input),
    ]
      .map(JSON.stringify)
      .join("\r\n")}\r\n`,
  );
  const split = bytes.indexOf(Buffer.from("😀")) + 2;
  const result = await runMcpCli(
    t,
    mcpEntry,
    ["--root", f.root],
    [bytes.subarray(0, split), bytes.subarray(split)],
  );
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const replies = result.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(replies.length, 3);
  assert.ok(replies.every((reply) => reply.jsonrpc === "2.0"));
  assert.equal(
    replies.find((reply) => reply.id === 2).result.tools[0].name,
    "log_work",
  );
  assert.equal(replies.find((reply) => reply.id === 3).result.isError, true);
  assert.equal(result.stdout.includes(f.saved.key), false);
  assert.equal(
    (await read(requestPath(f, input.id))).textDigest,
    createHash("sha256").update(input.text).digest("hex"),
  );
});

test("CLI rejects invalid argument combinations on stderr and no args opens DEFAULT_ROOT under HOME", async (t) => {
  const f = await setup(t);
  for (const args of [
    ["--other"],
    ["--root"],
    ["--root", f.root, "extra"],
    [f.root],
  ]) {
    const result = await runMcpCli(t, mcpEntry, args, []);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Local AI Harness unavailable.\n");
  }
  const result = await runMcpCli(
    t,
    mcpEntry,
    [],
    ['{"jsonrpc":"2.0","id":1,"method":"ping"}\n'],
    { ...process.env, HOME: f.root },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "Local AI Harness unavailable.\n");
  assert.deepEqual(JSON.parse(result.stdout).error, {
    code: -32603,
    message: "Internal server error",
  });
  assert.ok(
    (
      await stat(join(f.root, ".config/wellspent/codex-harness/requests"))
    ).isDirectory(),
  );
});

test("SDK owns malformed JSON, invalid envelopes and incomplete EOF behavior", async (t) => {
  const f = await setup(t);
  const result = await runMcpCli(
    t,
    mcpEntry,
    ["--root", f.root],
    [
      'not json\n{"jsonrpc":"1.0","id":9,"method":"ping"}\n',
      `${JSON.stringify(initializeMessage())}\n{"incomplete":`,
    ],
  );
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "Local AI Harness unavailable.\n");
  const replies = result.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].result.serverInfo.name, "wellspent-local");
});

test("SDK closes oversized input at the 128 KiB buffer limit without leaking content", async (t) => {
  const f = await setup(t);
  const oversized = `${JSON.stringify(toolCall(1, { id: randomUUID(), text: "private-fixture".repeat(10000) }))}\n`;
  assert.ok(Buffer.byteLength(oversized) > 128 * 1024);
  const result = await runMcpCli(t, mcpEntry, ["--root", f.root], [oversized]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Local AI Harness unavailable.\n");
  assert.deepEqual(await readdir(join(f.root, "requests")), []);
});

test("macOS resource helper and MCP bundles run under Node without checkout dependencies", async (t) => {
  const f = await setup(t);
  const output = join(f.root, "Fixture.app/Contents/Resources/LocalHarness");
  await promisify(execFile)("bun", [
    fileURLToPath(
      new URL("../../scripts/macos-harness-resources.ts", import.meta.url),
    ),
    output,
  ]);
  const helper = await promisify(execFile)(process.execPath, [
    join(output, "harness-helper.mjs"),
    "--root",
    f.root,
    "connection",
  ]);
  assert.equal(JSON.parse(helper.stdout).connectionID, f.saved.connectionID);
  const result = await runMcpCli(
    t,
    join(output, "harness-mcp.mjs"),
    ["--root", f.root],
    [
      `${[
        initializeMessage(),
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        toolCall(3, { id: randomUUID(), text: "Bundled note" }),
      ]
        .map(JSON.stringify)
        .join("\n")}\n`,
    ],
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const replies = result.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(replies.length, 3);
  assert.equal(
    replies.find((reply) => reply.id === 2).result.tools[0].name,
    "log_work",
  );
  assert.equal(replies.find((reply) => reply.id === 3).result.isError, true);
});
