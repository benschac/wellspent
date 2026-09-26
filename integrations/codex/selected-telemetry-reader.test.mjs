import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bodyDigest, decode, sign } from "./local-contract.mjs";
import {
  capture,
  dispatch,
  openLocalRoot,
  read,
  setup,
} from "./local-helper.mjs";
import {
  pauseTelemetrySource,
  READER_LIMITS,
  readSelectedTelemetry,
  resumeTelemetrySource,
  selectedReaderStatus,
  selectTelemetrySource,
} from "./selected-telemetry-reader.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../../docs/design/probes/c3a/fixture.json", import.meta.url),
  ),
);
const vectors = JSON.parse(
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
    ...vectors.binding,
    issuedAt: "2027-01-15T08:00:00.000Z",
    acceptUntil: "2027-01-22T08:00:00.000Z",
  },
};
const item = (type, payload) => ({
  type,
  timestamp: "2027-01-15T08:00:05.000Z",
  payload,
});
const usage = (id = "response_1") =>
  item("token_usage_record", {
    thread_id: bundle.binding.threadID,
    session_id: "session_1",
    turn_id: "turn_1",
    root_turn_id: "root_1",
    response_id: id,
    usage: {
      input_tokens: 20,
      cached_input_tokens: 10,
      output_tokens: 3,
      reasoning_output_tokens: 1,
      total_tokens: 23,
      private: "PRIVATE_CANARY",
    },
    thread_token_usage: { total_tokens: 999999 },
    turn_token_usage: { total_tokens: 999999 },
    parent_path: "/PRIVATE_CANARY",
    child_path: "/PRIVATE_CANARY",
    model: "PRIVATE_CANARY",
  });
const config = () =>
  item("turn_context", {
    turn_id: "turn_1",
    root_turn_id: "root_1",
    model: "gpt-6-sol",
    effort: "medium",
    cwd: "/PRIVATE_CANARY",
    developer_instructions: "PRIVATE_CANARY",
  });
const line = (value) => `${JSON.stringify(value)}\n`;
const control = (domain) =>
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
async function fixtureRoot(t, history = "PRIVATE_HISTORY_NOT_JSON\n") {
  const dir = await mkdtemp(
    join(await realpath(tmpdir()), "wellspent-reader-"),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = await openLocalRoot(join(dir, "spool"));
  await setup(root, bundle);
  const filePath = join(dir, "explicit.jsonl");
  await writeFile(filePath, history, { mode: 0o600 });
  const selection = {
    filePath,
    eofOffset: Buffer.byteLength(history),
    bindingID: bundle.binding.bindingID,
    sourceVersion: "0.157.1",
    sessionID: "session_1",
    endsAt: "2027-01-15T08:05:00.000Z",
  };
  return { root, filePath, selection, dir };
}
async function pending(root) {
  const names = await readdir(join(root, "telemetry-pending"));
  return Promise.all(
    names.map(
      async (name) =>
        decode(await read(join(root, "telemetry-pending", name))).value,
    ),
  );
}
async function ack(root, packet) {
  return dispatch(
    root,
    "/v2/ack",
    sign(
      {
        observationID: decode(packet).value.observationID,
        bodyDigest: bodyDigest(packet),
        nativeReceivedAt: at.toISOString(),
      },
      key,
      "telemetry-ack",
    ),
    at,
  );
}
async function privateText(path) {
  let result = "";
  for (const name of await readdir(path, { withFileTypes: true })) {
    const file = join(path, name.name);
    result += name.isDirectory()
      ? await privateText(file)
      : await readFile(file, "utf8");
  }
  return result;
}

test("explicit EOF only; source allowlist, configuration separation and privacy canaries", async (t) => {
  const f = await fixtureRoot(t);
  assert.deepEqual(await selectedReaderStatus(f.root), {
    enabled: false,
    status: "not_selected",
  });
  await selectTelemetrySource(f.root, f.selection, at);
  await appendFile(
    f.filePath,
    [
      config(),
      usage(),
      item("response_item", { content: "PRIVATE_CANARY" }),
      item("event_msg", { type: "token_count", total: 999999 }),
    ]
      .map(line)
      .join(""),
  );
  const result = await readSelectedTelemetry(f.root, at);
  assert.equal(result.status, "caught_up");
  assert.equal(result.counts.published, 2);
  assert.equal(result.cursor, (await stat(f.filePath)).size);
  const packets = await pending(f.root);
  assert.equal(packets.find((p) => p.kind === "turnConfiguration").usage, null);
  assert.equal(
    packets.find((p) => p.kind === "responseUsage").configuredModel,
    null,
  );
  assert.equal(
    packets.find((p) => p.kind === "responseUsage").usage.totalTokens,
    23,
  );
  assert.doesNotMatch(
    await privateText(f.root),
    /PRIVATE_CANARY|PRIVATE_HISTORY|999999/,
  );
  for (const name of await readdir(join(f.root, "telemetry-pending"))) {
    const packet = await read(join(f.root, "telemetry-pending", name));
    assert.doesNotMatch(
      Buffer.from(packet.body, "base64").toString(),
      /PRIVATE_CANARY|999999/,
    );
    assert.deepEqual(
      packet,
      decode(packet).value.kind === "turnConfiguration"
        ? vectors.configuration
        : vectors.responseUsage,
    );
  }
});

test("duplicates and reordered responses survive delayed/lost ACKs without changing first bytes", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  await appendFile(
    f.filePath,
    [usage("response_2"), config(), usage()].map(line).join(""),
  );
  await readSelectedTelemetry(f.root, at);
  const first = await dispatch(
    f.root,
    "/v2/poll",
    control("telemetry-poll"),
    at,
  );
  // Lost ACK: helper still returns exact packet. A later duplicate has a changed wrapper time.
  const copy = usage();
  copy.timestamp = "2027-01-15T08:00:06.000Z";
  await appendFile(
    f.filePath,
    [copy, usage("response_2"), config()].map(line).join(""),
  );
  const result = await readSelectedTelemetry(
    f.root,
    new Date(at.getTime() + 1000),
  );
  assert.equal(result.counts.duplicate, 3);
  assert.deepEqual(
    (await dispatch(f.root, "/v2/poll", control("telemetry-poll"), at)).packet,
    first.packet,
  );
  await ack(f.root, first.packet);
  await ack(f.root, first.packet);
  await appendFile(
    f.filePath,
    [copy, usage("response_2"), config()].map(line).join(""),
  );
  await readSelectedTelemetry(f.root, new Date(at.getTime() + 2000));
  assert.equal((await pending(f.root)).length, 2);
});

for (const conflict of ["counter", "turn", "root", "configuration"]) {
  test(`conflicting ${conflict} freezes cursor visibly; v1 remains independent`, async (t) => {
    const f = await fixtureRoot(t);
    await selectTelemetrySource(f.root, f.selection, at);
    const original = conflict === "configuration" ? config() : usage();
    await appendFile(f.filePath, line(original));
    const before = await readSelectedTelemetry(f.root, at);
    const changed = structuredClone(original);
    if (conflict === "counter") {
      changed.payload.usage.input_tokens++;
      changed.payload.usage.total_tokens++;
    }
    if (conflict === "turn") changed.payload.turn_id = "turn_2";
    if (conflict === "root") changed.payload.root_turn_id = "root_2";
    if (conflict === "configuration") changed.payload.model = "gpt-6-luna";
    await appendFile(f.filePath, line(changed));
    const after = await readSelectedTelemetry(f.root, at);
    assert.equal(after.status, "identityConflict");
    assert.equal(after.cursor, before.cursor);
    assert.equal(after.pendingPublication, true);
    assert.equal((await pending(f.root)).length, 1);
    assert.equal(
      (
        await capture(
          f.root,
          {
            hook_event_name: "PostToolUse",
            session_id: bundle.binding.threadID,
            turn_id: "turn_1",
            tool_use_id: "tool_1",
            tool_name: "Bash",
            tool_response: { exit_code: 0 },
          },
          at,
        )
      ).queued,
      true,
    );
    assert.ok((await dispatch(f.root, "/v1/poll", control("poll"), at)).packet);
  });
}

test("partial and malformed lines, unknown usage and ignored content have durable diagnostics", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  const text = line(usage());
  await appendFile(f.filePath, text.slice(0, -4));
  const partial = await readSelectedTelemetry(f.root, at);
  assert.equal(partial.status, "partial_line");
  assert.equal(partial.cursor, f.selection.eofOffset);
  assert.equal((await pending(f.root)).length, 0);
  await appendFile(f.filePath, text.slice(-4));
  const missing = usage("missing");
  delete missing.payload.usage;
  const invalid = usage("invalid");
  invalid.payload.usage.total_tokens = -1;
  await appendFile(
    f.filePath,
    `PRIVATE_CANARY_NOT_JSON\n${line(missing)}${line(invalid)}${line(usage("valid"))}`,
  );
  const result = await readSelectedTelemetry(f.root, at);
  assert.equal(result.counts.malformed_record, 1);
  assert.equal(result.counts.usage_unknown, 1);
  assert.equal(result.counts.invalidPacket, 1);
  assert.equal((await pending(f.root)).length, 2);
  assert.doesNotMatch(await privateText(f.root), /PRIVATE_CANARY_NOT_JSON/);
});

for (const change of [
  "truncate",
  "replace",
  "permission",
  "remove",
  "rewrite",
]) {
  test(`${change} stops source access with a visible gap and retained cursor`, async (t) => {
    const f = await fixtureRoot(t);
    await selectTelemetrySource(f.root, f.selection, at);
    await appendFile(f.filePath, line(usage()));
    const before = await readSelectedTelemetry(f.root, at);
    if (change === "truncate") await truncate(f.filePath, 0);
    if (change === "replace") {
      await rename(f.filePath, `${f.filePath}.old`);
      await writeFile(f.filePath, "replacement\n", { mode: 0o600 });
    }
    if (change === "permission") await chmod(f.filePath, 0);
    if (change === "remove") await rm(f.filePath);
    if (change === "rewrite")
      await writeFile(f.filePath, "x".repeat(before.cursor));
    const result = await readSelectedTelemetry(f.root, at);
    assert.equal(result.enabled, false);
    assert.equal(result.cursor, before.cursor);
    assert.equal(
      result.lastGap.reason,
      {
        truncate: "source_truncated",
        replace: "source_replaced",
        permission: "source_permission",
        remove: "source_unavailable",
        rewrite: "source_rewritten",
      }[change],
    );
    assert.equal((await pending(f.root)).length, 1);
  });
}

test("version, identity, symlink, partial baseline and stale EOF gates never backfill", async (t) => {
  const f = await fixtureRoot(t);
  await assert.rejects(
    selectTelemetrySource(
      f.root,
      { ...f.selection, sourceVersion: "0.158.0" },
      at,
    ),
    /unsupported_source_version/,
  );
  await assert.rejects(
    selectTelemetrySource(f.root, { ...f.selection, eofOffset: 0 }, at),
    /eof_changed/,
  );
  await symlink(f.filePath, `${f.filePath}.link`);
  await assert.rejects(
    selectTelemetrySource(
      f.root,
      { ...f.selection, filePath: `${f.filePath}.link` },
      at,
    ),
    /source_path/,
  );
  await appendFile(f.filePath, "partial");
  await assert.rejects(
    selectTelemetrySource(
      f.root,
      { ...f.selection, eofOffset: (await stat(f.filePath)).size },
      at,
    ),
    /eof_partial_line/,
  );
  await appendFile(f.filePath, "\n");
  await selectTelemetrySource(
    f.root,
    { ...f.selection, eofOffset: (await stat(f.filePath)).size },
    at,
  );
  await appendFile(
    f.filePath,
    line(
      item("session_meta", {
        id: bundle.binding.threadID,
        session_id: "session_1",
        cli_version: "0.158.0",
        instructions: "PRIVATE_CANARY",
      }),
    ),
  );
  assert.equal(
    (await readSelectedTelemetry(f.root, at)).status,
    "unsupported_source_version",
  );
  assert.equal((await pending(f.root)).length, 0);
});

test("no foreign thread or referenced ancestor/child is followed", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  const foreign = usage();
  foreign.payload.thread_id = "other";
  await appendFile(f.filePath, line(foreign));
  assert.equal(
    (await readSelectedTelemetry(f.root, at)).status,
    "source_identity_mismatch",
  );
  assert.equal((await pending(f.root)).length, 0);
});

test("bounded read/line/record limits and expiry", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  await appendFile(
    f.filePath,
    Array.from({ length: 65 }, (_, i) => line(usage(`r_${i}`))).join(""),
  );
  assert.equal((await readSelectedTelemetry(f.root, at)).status, "read_limit");
  assert.equal((await pending(f.root)).length, 64);
  await readSelectedTelemetry(f.root, at);
  assert.equal((await pending(f.root)).length, 65);
  await appendFile(f.filePath, "a".repeat(READER_LIMITS.line + 1));
  assert.equal(
    (await readSelectedTelemetry(f.root, at)).status,
    "line_too_large",
  );
  const g = await fixtureRoot(t);
  await selectTelemetrySource(g.root, g.selection, at);
  await appendFile(g.filePath, line(usage()));
  assert.equal(
    (await readSelectedTelemetry(g.root, new Date(g.selection.endsAt))).status,
    "window_ended",
  );
  assert.equal((await pending(g.root)).length, 0);
});

test("pause/resume excludes the exact unread byte range; fresh binding stays explicit", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  await appendFile(f.filePath, line(usage()));
  await readSelectedTelemetry(f.root, at);
  await pauseTelemetrySource(f.root, at);
  await appendFile(f.filePath, line(usage("paused")));
  assert.equal((await readSelectedTelemetry(f.root, at)).status, "paused");
  const resumed = await resumeTelemetrySource(
    f.root,
    { ...f.selection, eofOffset: (await stat(f.filePath)).size },
    at,
  );
  assert.equal(resumed.lastGap.reason, "pause_resume");
  assert.ok(resumed.lastGap.to > resumed.lastGap.from);
  await appendFile(f.filePath, line(usage("after")));
  await readSelectedTelemetry(f.root, at);
  assert.deepEqual((await pending(f.root)).map((p) => p.responseID).sort(), [
    "after",
    "response_1",
  ]);
});

function crashRead(root, phase) {
  const moduleURL = new URL("./selected-telemetry-reader.mjs", import.meta.url)
    .href;
  const script = `import { readSelectedTelemetry } from ${JSON.stringify(moduleURL)}; await readSelectedTelemetry(process.argv[1], new Date(${JSON.stringify(at.toISOString())}), async (phase) => { if (phase === process.argv[2]) process.kill(process.pid, 'SIGKILL'); });`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, root, phase],
      { stdio: "pipe" },
    );
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}
for (const phase of [
  "read_before_journal",
  "journal_saved",
  "observation_saved",
  "published",
  "cursor_saved",
  "excluded_cursor_saved",
]) {
  test(`SIGKILL/restart at ${phase} cannot skip an eligible record`, async (t) => {
    const f = await fixtureRoot(t);
    await selectTelemetrySource(f.root, f.selection, at);
    await appendFile(
      f.filePath,
      `${phase === "excluded_cursor_saved" ? "bad\n" : ""}${line(usage())}${line(usage("next"))}`,
    );
    assert.equal((await crashRead(f.root, phase)).signal, "SIGKILL");
    const recovered = await readSelectedTelemetry(
      f.root,
      new Date(at.getTime() + 1000),
    );
    assert.equal(recovered.cursor, (await stat(f.filePath)).size);
    assert.equal(recovered.lastGap.reason, "reader_restart");
    assert.equal(recovered.pendingPublication, false);
    assert.deepEqual((await pending(f.root)).map((p) => p.responseID).sort(), [
      "next",
      "response_1",
    ]);
    if (["journal_saved", "observation_saved", "published"].includes(phase)) {
      assert.equal(
        (await pending(f.root)).find((p) => p.responseID === "response_1")
          .helperReceivedAt,
        at.toISOString(),
      );
    }
  });
}

test("ACK between publish and cursor restart uses receipt without recreating packet", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  await appendFile(f.filePath, line(usage()));
  assert.equal((await crashRead(f.root, "published")).signal, "SIGKILL");
  const result = await dispatch(
    f.root,
    "/v2/poll",
    control("telemetry-poll"),
    at,
  );
  await ack(f.root, result.packet);
  await readSelectedTelemetry(f.root, new Date(at.getTime() + 1000));
  assert.equal((await pending(f.root)).length, 0);
  assert.equal(
    (await selectedReaderStatus(f.root)).cursor,
    (await stat(f.filePath)).size,
  );
});

test("queue pressure retains journal and cursor, then republishes original time", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  const files = Array.from({ length: 1000 }, (_, i) =>
    join(f.root, "telemetry-pending", `filler_${i}.json`),
  );
  await Promise.all(
    files.map((file) => writeFile(file, "{}", { mode: 0o600 })),
  );
  await appendFile(f.filePath, line(usage()));
  const blocked = await readSelectedTelemetry(f.root, at);
  assert.equal(blocked.status, "queue_full");
  assert.equal(blocked.cursor, f.selection.eofOffset);
  assert.equal(blocked.pendingPublication, true);
  await Promise.all(files.map((file) => rm(file)));
  const recovered = await readSelectedTelemetry(
    f.root,
    new Date(at.getTime() + 1000),
  );
  assert.equal(recovered.cursor, (await stat(f.filePath)).size);
  assert.equal((await pending(f.root))[0].helperReceivedAt, at.toISOString());
});

test("missing configuration identities, malformed UTF-8 and unknown record variants are excluded", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  const missing = config();
  delete missing.payload.turn_id;
  await appendFile(f.filePath, Buffer.from([0xff, 10]));
  await appendFile(
    f.filePath,
    line(missing) +
      line(item("future_record", { private: "PRIVATE_CANARY" })) +
      line(usage()),
  );
  const result = await readSelectedTelemetry(f.root, at);
  assert.equal(result.counts.malformed_record, 2);
  assert.equal((await pending(f.root)).length, 1);
});

test("read byte budget ends inside a complete source line without consuming that partial read", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  const ignored = line(item("response_item", { content: "x".repeat(60000) }));
  await appendFile(f.filePath, ignored.repeat(5) + line(usage()));
  const first = await readSelectedTelemetry(f.root, at);
  assert.equal(
    first.cursor,
    f.selection.eofOffset + Buffer.byteLength(ignored) * 4,
  );
  assert.ok(first.cursor - f.selection.eofOffset <= READER_LIMITS.read);
  assert.equal((await pending(f.root)).length, 0);
  const second = await readSelectedTelemetry(f.root, at);
  assert.equal(second.cursor, (await stat(f.filePath)).size);
  assert.equal((await pending(f.root)).length, 1);
});

test("CLI refuses unsupported selection with content-free version status", async (t) => {
  const f = await fixtureRoot(t);
  const cli = new URL("./selected-telemetry-reader.mjs", import.meta.url);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli.pathname, f.root, "select"], {
      stdio: "pipe",
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stderr }));
    child.stdin.end(
      JSON.stringify({ ...f.selection, sourceVersion: "PRIVATE_CANARY" }),
    );
  });
  assert.equal(result.code, 1);
  assert.equal(
    result.stderr,
    "selected_reader_failed:unsupported_source_version\n",
  );
  assert.equal((await selectedReaderStatus(f.root)).enabled, false);
});
test("native permit is rechecked at source open after journal/lock work", async (t) => {
  const f = await fixtureRoot(t);
  await selectTelemetrySource(f.root, f.selection, at);
  await appendFile(f.filePath, line(config()));
  let checks = 0;
  const stopped = await readSelectedTelemetry(
    f.root,
    at,
    undefined,
    async () => ++checks === 1,
  );
  assert.equal(checks, 2);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.cursor, f.selection.eofOffset);
  assert.equal((await pending(f.root)).length, 0);
});
