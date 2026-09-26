#!/usr/bin/env node
// Explicit, bounded source access only. No history lookup, watcher, or SQLite writer.
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalTime,
  opaque,
  uuid,
  validateBundle,
} from "./local-contract.mjs";
import {
  enqueueTelemetry,
  lock,
  openLocalRoot,
  optional,
  privateDirectory,
  publish,
  read,
  sync,
} from "./local-helper.mjs";
import { telemetryFromSynthetic } from "./telemetry-contract.mjs";

export const READER_LIMITS = Object.freeze({
  read: 256 * 1024,
  line: 64 * 1024,
  records: 64,
  observations: 10000,
  windowMS: 5 * 60 * 1000,
  totalBytes: 2 * 1024 * 1024,
});
const processEpoch = randomUUID();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const spoolRoot = (root) => (typeof root === "string" ? root : root.spoolRoot);
const readerRoot = (root) =>
  typeof root === "string" ? join(root, "selected-reader") : root.readerRoot;
const statePath = (root) => join(readerRoot(root), "state.json");
// Isolate source state/ledgers while retaining the original shared bindings and HTTP spool.
export function scopedTelemetryReader(root, sourceID) {
  if (!/^[a-f0-9]{64}$/.test(sourceID)) fail("invalid_source");
  return {
    spoolRoot: root,
    readerRoot: join(root, "automatic-readers", sourceID),
  };
}
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (code) => {
  throw new Error(code);
};
const identity = (stat) => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
const checkpointDefault = async () => {};
const allowReadDefault = async () => true;

async function source(path, allowRead = allowReadDefault) {
  if (!(await allowRead())) fail("authorization_required");
  // Reject aliases, symlinks, devices and FIFOs before opening. Never enumerate a source directory.
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    (await realpath(path)) !== path
  )
    fail("source_path");
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.uid !== process.getuid?.() ||
    !(before.mode & 0o400)
  )
    fail("source_permission");
  if (!(await allowRead())) fail("authorization_required");
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  const stat = await handle.stat();
  if (!stat.isFile() || identity(stat) !== identity(before)) {
    await handle.close();
    fail("source_replaced");
  }
  return { handle, stat };
}

async function binding(root, id) {
  if (typeof id !== "string" || !uuid.test(id)) fail("invalid_binding");
  return validateBundle(
    await read(join(spoolRoot(root), "bindings", `${id.toLowerCase()}.json`)),
  );
}

function visible(state) {
  if (!state) return { enabled: false, status: "not_selected" };
  return {
    enabled: state.active,
    status: state.status,
    coverage: "partial",
    cursor: state.cursor,
    baseline: state.baseline,
    sourceVersion: state.sourceVersion,
    versionBasis: state.versionBasis ?? "explicit_selection",
    pendingPublication: state.journal !== null,
    counts: state.counts,
    gaps: state.gaps,
    lastGap: state.lastGap,
    lastReadAt: state.lastReadAt,
    endsAt: state.endsAt,
    bytesRead: state.bytesRead ?? 0,
    maxBytes: state.maxBytes ?? READER_LIMITS.totalBytes,
  };
}
export async function selectedReaderStatus(root) {
  return visible(await optional(statePath(root)));
}
async function save(root, state) {
  await publish(statePath(root), state, true);
}
function gap(state, reason, at, from = state.cursor, to = state.cursor) {
  state.gaps++;
  state.lastGap = { reason, at, from, to, since: state.lastReadAt };
  count(state, `gap_${reason}`);
}
function count(state, reason) {
  state.counts[reason] = (state.counts[reason] ?? 0) + 1;
}

/** Selection is an explicit file + EOF + declared source version/session, never a thread-to-path lookup. */
export async function selectTelemetrySource(root, selection, now = new Date()) {
  await privateDirectory(readerRoot(root));
  await privateDirectory(join(readerRoot(root), "observations"));
  return lock(readerRoot(root), async () => {
    if (await optional(statePath(root))) fail("source_already_selected");
    const state = await baseline(root, selection, now);
    await save(root, state);
    return visible(state);
  });
}
async function baseline(root, selection, now, allowRead = allowReadDefault) {
  if (selection.sourceVersion !== "0.157.1") fail("unsupported_source_version");
  if (
    typeof selection.sessionID !== "string" ||
    !opaque.test(selection.sessionID)
  )
    fail("invalid_session");
  const automatic = typeof root !== "string";
  if (
    !automatic &&
    (!Number.isSafeInteger(selection.eofOffset) || selection.eofOffset < 0)
  )
    fail("invalid_eof");
  if (
    !canonicalTime(selection.endsAt) ||
    Date.parse(selection.endsAt) <= now.getTime() ||
    Date.parse(selection.endsAt) - now.getTime() >
      (automatic ? 8 * 60 * 60 * 1000 : READER_LIMITS.windowMS)
  )
    fail("invalid_window");
  const maxBytes = selection.maxBytes ?? READER_LIMITS.totalBytes;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > READER_LIMITS.totalBytes
  )
    fail("invalid_byte_limit");
  const bundle = await binding(root, selection.bindingID);
  const { handle, stat } = await source(selection.filePath, allowRead);
  try {
    if (!automatic && stat.size !== selection.eofOffset) fail("eof_changed");
    if (automatic && selection.fileIdentity !== identity(stat))
      fail("source_replaced");
    let skipPartial = false;
    // Read only the boundary byte, never a historical JSONL record/header.
    if (stat.size > 0) {
      const byte = Buffer.alloc(1);
      if (!(await allowRead())) fail("authorization_required");
      await handle.read(byte, 0, 1, stat.size - 1);
      if (byte[0] !== 10) {
        if (!automatic) fail("eof_partial_line");
        skipPartial = true;
      }
    }
    return {
      version: 1,
      filePath: selection.filePath,
      fileIdentity: identity(stat),
      versionBasis: automatic ? "session_header" : "explicit_selection",
      sourceVersion: selection.sourceVersion,
      sessionID: selection.sessionID,
      threadID: bundle.binding.threadID,
      bindingID: bundle.binding.bindingID,
      baseline: stat.size,
      skipPartial,
      maxBytes,
      bytesRead: stat.size > 0 ? 1 : 0,
      cursor: stat.size,
      observedSize: stat.size,
      anchor: null,
      active: true,
      status: "selected",
      endsAt: selection.endsAt,
      lastReadAt: now.toISOString(),
      epoch: processEpoch,
      counts: {},
      gaps: 1,
      lastGap: {
        reason: "eof_baseline",
        at: now.toISOString(),
        from: 0,
        to: stat.size,
      },
      journal: null,
    };
  } finally {
    await handle.close();
  }
}

/** Supervisor-only explicit authorization: retain observation identities and queued bytes. */
export async function replaceTelemetrySource(
  root,
  selection,
  now = new Date(),
  allowRead = allowReadDefault,
) {
  await privateDirectory(readerRoot(root));
  await privateDirectory(join(readerRoot(root), "observations"));
  return lock(readerRoot(root), async () => {
    const old = await optional(statePath(root));
    if (old) {
      if (old.active) fail("pause_or_recover_first");
      await recover(root, old, checkpointDefault);
      if (old.bindingID === selection.bindingID) fail("fresh_binding_required");
    }
    const next = await baseline(root, selection, now, allowRead);
    await save(root, next);
    return visible(next);
  });
}

/** Recover only metadata already journaled; never open the selected source. */
export async function stopSelectedTelemetry(
  root,
  reason = "stopped",
  now = new Date(),
) {
  await privateDirectory(readerRoot(root));
  return lock(readerRoot(root), async () => {
    const state = await optional(statePath(root));
    if (!state) return visible(null);
    if (state.active) gap(state, reason, now.toISOString());
    state.active = false;
    state.status = reason;
    await save(root, state);
    await recover(root, state, checkpointDefault);
    return visible(state);
  });
}

/** Resume always requires another explicit EOF; unread pause bytes are a visible excluded range. */
export async function resumeTelemetrySource(root, selection, now = new Date()) {
  return lock(readerRoot(root), async () => {
    const old = await read(statePath(root));
    if (old.active || old.journal) fail("pause_or_recover_first");
    if (
      selection.filePath !== old.filePath ||
      selection.sessionID !== old.sessionID
    )
      fail("selection_changed");
    const next = await baseline(root, selection, now);
    if (
      next.fileIdentity !== old.fileIdentity ||
      next.cursor < old.observedSize
    )
      fail("source_changed");
    next.counts = old.counts;
    next.gaps = old.gaps;
    gap(next, "pause_resume", now.toISOString(), old.cursor, next.cursor);
    await save(root, next);
    return visible(next);
  });
}
export async function pauseTelemetrySource(root, now = new Date()) {
  return lock(readerRoot(root), async () => {
    const state = await read(statePath(root));
    state.active = false;
    state.status = "paused";
    gap(state, "pause", now.toISOString());
    await save(root, state);
    return visible(state);
  });
}

function normalize(item, state) {
  if (!object(item) || typeof item.type !== "string") fail("malformed_record");
  const p = item.payload;
  if (item.type === "session_meta") {
    if (p?.cli_version !== state.sourceVersion)
      fail("unsupported_source_version");
    if (p.id !== state.threadID || p.session_id !== state.sessionID)
      fail("source_identity_mismatch");
    return null;
  }
  if (!["turn_context", "token_usage_record"].includes(item.type)) return null;
  if (!object(p) || !canonicalTime(item.timestamp)) fail("malformed_record");
  if (typeof p.turn_id !== "string" || !opaque.test(p.turn_id))
    fail("malformed_record");
  if (
    p.root_turn_id != null &&
    (typeof p.root_turn_id !== "string" || !opaque.test(p.root_turn_id))
  )
    fail("malformed_record");
  const common = {
    sourceVersion: state.sourceVersion,
    sourceWrittenAt: item.timestamp,
    sessionID: state.sessionID,
    turnID: p.turn_id,
  };
  if (item.type === "turn_context") {
    // In 0.157.1 root_turn_id is only set for subagent turns. No linked file is opened.
    return {
      ...common,
      kind: "turnConfiguration",
      rootTurnID: p.root_turn_id ?? p.turn_id,
      configuredModel: p.model,
      configuredEffort: p.effort ?? null,
    };
  }
  if (p.thread_id !== state.threadID || p.session_id !== state.sessionID)
    fail("source_identity_mismatch");
  if (
    typeof p.root_turn_id !== "string" ||
    typeof p.response_id !== "string" ||
    !opaque.test(p.response_id)
  )
    fail("malformed_record");
  if (!object(p.usage)) fail("usage_unknown");
  const u = p.usage;
  return {
    ...common,
    kind: "responseUsage",
    rootTurnID: p.root_turn_id,
    responseID: p.response_id,
    usage: {
      inputTokens: u.input_tokens,
      cachedInputTokens: u.cached_input_tokens,
      cacheWriteInputTokens: u.cache_write_input_tokens ?? null,
      outputTokens: u.output_tokens,
      reasoningOutputTokens: u.reasoning_output_tokens,
      totalTokens: u.total_tokens,
    },
  };
}

async function recover(root, state, checkpoint) {
  const entry = state.journal;
  if (!entry) return;
  const directory = join(readerRoot(root), "observations");
  const path = join(directory, `${entry.key}.json`);
  const prior = await optional(path);
  if (prior && prior.signature !== entry.signature) fail("identityConflict");
  if (!prior) {
    if ((await readdir(directory)).length >= READER_LIMITS.observations)
      fail("observation_limit");
    await publish(path, entry);
  }
  // Also sync an existing entry: a previous process may have died after link/rename.
  await sync(directory);
  await checkpoint("observation_saved");
  // Original first-observed body/time/binding survives copied lines, new receipts and lost ACKs.
  const original = prior ?? entry;
  await enqueueTelemetry(
    spoolRoot(root),
    original.bindingID,
    original.input,
    new Date(original.receivedAt),
  );
  // Duplicate/receipt retries can observe a link made just before a failed directory sync.
  await sync(join(spoolRoot(root), "telemetry-pending"));
  await sync(join(spoolRoot(root), "telemetry-receipts"));
  await checkpoint("published");
  state.cursor = entry.nextCursor;
  state.anchor = entry.anchor;
  state.journal = null;
  count(state, prior ? "duplicate" : "published");
  await save(root, state);
  await checkpoint("cursor_saved");
}

const stopErrors = new Set([
  "unsupported_source_version",
  "source_identity_mismatch",
  "source_replaced",
  "source_truncated",
  "source_rewritten",
  "source_permission",
  "source_path",
  "line_too_large",
  "identityConflict",
  "observation_limit",
  "byte_limit",
  "authorization_required",
]);
function errorCode(error) {
  if (["EACCES", "EPERM"].includes(error.code)) return "source_permission";
  if (["ENOENT", "ELOOP"].includes(error.code)) return "source_unavailable";
  if (
    stopErrors.has(error.message) ||
    [
      "unsupported_reader_version",
      "source_already_selected",
      "invalid_binding",
      "invalid_session",
      "invalid_eof",
      "invalid_window",
      "invalid_byte_limit",
      "fresh_binding_required",
      "eof_changed",
      "eof_partial_line",
      "pause_or_recover_first",
      "selection_changed",
      "source_changed",
      "invalid_command",
      "selection_too_large",
      "usage_unknown",
      "malformed_record",
      "queue_full",
      "invalidPacket",
    ].includes(error.message)
  )
    return error.message;
  return "reader_io_error"; // Never print raw parse errors, paths, or record content.
}

/** One bounded read per explicit call. The normal helper serve command never invokes this. */
export async function readSelectedTelemetry(
  root,
  now = new Date(),
  checkpoint = checkpointDefault,
  allowRead = allowReadDefault,
  threadName = undefined,
) {
  return lock(readerRoot(root), async () => {
    const state = await read(statePath(root));
    if (state.version !== 1) fail("unsupported_reader_version");
    if (state.sourceVersion !== "0.157.1") fail("unsupported_source_version");
    try {
      if (state.epoch !== processEpoch) {
        gap(state, "reader_restart", now.toISOString());
        state.epoch = processEpoch;
        await save(root, state);
      }
      // Recover already-authorized metadata even if source access/window ended. Never reread it.
      await recover(root, state, checkpoint);
      if (!state.active) return visible(state);
      if (now.getTime() >= Date.parse(state.endsAt)) {
        state.active = false;
        state.status = "window_ended";
        gap(state, "window_ended", now.toISOString());
        await save(root, state);
        return visible(state);
      }
      const bundle = await binding(root, state.bindingID);
      const { handle, stat } = await source(state.filePath, allowRead);
      try {
        if (identity(stat) !== state.fileIdentity) fail("source_replaced");
        if (stat.size < state.observedSize) fail("source_truncated");
        const remaining =
          (state.maxBytes ?? READER_LIMITS.totalBytes) - (state.bytesRead ?? 0);
        const anchorLength = state.anchor?.length ?? 0;
        const requested = Math.min(
          READER_LIMITS.read,
          stat.size - state.cursor,
        );
        if (
          remaining < anchorLength ||
          (requested > 0 && remaining === anchorLength)
        )
          fail("byte_limit");
        const readLength = Math.min(requested, remaining - anchorLength);
        // Reserve before IO, so a crash cannot reset or undercount private-source access.
        state.bytesRead = (state.bytesRead ?? 0) + anchorLength + readLength;
        await save(root, state);
        if (state.anchor) {
          const bytes = Buffer.alloc(state.anchor.length);
          if (!(await allowRead())) fail("authorization_required");
          await handle.read(
            bytes,
            0,
            bytes.length,
            state.cursor - bytes.length,
          );
          if (hash(bytes) !== state.anchor.hash) fail("source_rewritten");
        }
        const bytes = Buffer.alloc(readLength);
        if (!(await allowRead())) fail("authorization_required");
        const { bytesRead } = await handle.read(
          bytes,
          0,
          bytes.length,
          state.cursor,
        );
        const after = await handle.stat();
        if (identity(await lstat(state.filePath)) !== state.fileIdentity)
          fail("source_replaced");
        if (after.size < stat.size) fail("source_truncated");
        state.observedSize = stat.size;
        state.lastReadAt = now.toISOString();
        await save(root, state);
        await checkpoint("read_before_journal");
        let start = 0;
        let records = 0;
        state.status = "caught_up";
        while (start < bytesRead && records < READER_LIMITS.records) {
          const end = bytes.indexOf(10, start);
          if (end < 0) {
            if (bytesRead - start > READER_LIMITS.line) fail("line_too_large");
            state.status = "partial_line";
            break;
          }
          if (end - start > READER_LIMITS.line) fail("line_too_large");
          const line = bytes.subarray(start, end);
          const skipPartial = state.skipPartial;
          const nextCursor = state.cursor + end + 1 - start;
          const anchorBytes = bytes.subarray(
            Math.max(start, end + 1 - 256),
            end + 1,
          );
          const anchor = {
            length: anchorBytes.length,
            hash: hash(anchorBytes),
          };
          let input;
          try {
            let item;
            try {
              item = skipPartial
                ? null
                : JSON.parse(
                    new TextDecoder("utf-8", { fatal: true }).decode(line),
                  );
            } catch {
              fail("malformed_record");
            }
            input = state.skipPartial ? null : normalize(item, state);
            if (input) {
              if (threadName !== undefined) input.threadName = threadName;
              telemetryFromSynthetic(input, bundle.binding, now);
            }
          } catch (error) {
            if (stopErrors.has(error.message)) throw error;
            // Invalid complete lines are excluded with durable counts; missing usage is never zero.
            count(state, errorCode(error));
            input = null;
          }
          if (input) {
            // Deduplicate by source response, detecting changed turn/root/counters as conflicts too.
            const key = hash(
              JSON.stringify([
                state.threadID,
                input.kind,
                input.responseID ?? input.turnID,
              ]),
            );
            // A rename must not conflict with a replay of the same usage atom.
            // Recovery retains the original first-observed name and packet.
            const {
              sourceWrittenAt: _time,
              threadName: _name,
              ...semantic
            } = input;
            state.journal = {
              key,
              signature: hash(JSON.stringify(semantic)),
              input,
              receivedAt: now.toISOString(),
              bindingID: state.bindingID,
              nextCursor,
              anchor,
            };
            await save(root, state);
            await checkpoint("journal_saved");
            await recover(root, state, checkpoint);
          } else {
            state.cursor = nextCursor;
            state.skipPartial = false;
            state.anchor = anchor;
            count(state, "excluded");
            await save(root, state);
            await checkpoint("excluded_cursor_saved");
          }
          start = end + 1;
          records++;
        }
        if (
          records === READER_LIMITS.records ||
          (bytesRead === READER_LIMITS.read && state.status === "caught_up")
        )
          state.status = "read_limit";
        await save(root, state);
        return visible(state);
      } finally {
        await handle.close();
      }
    } catch (error) {
      // Tests may terminate the process at checkpoints. All actual errors keep cursor/journal retryable.
      const code = errorCode(error);
      // Reload: a failed atomic write may have committed. Never overwrite a newer durable cursor.
      const durable = await read(statePath(root));
      durable.status = code === "authorization_required" ? "stopped" : code;
      count(durable, code);
      if (stopErrors.has(code) || code === "source_unavailable")
        durable.active = false;
      gap(durable, code, now.toISOString());
      await save(root, durable);
      return visible(durable);
    }
  });
}

async function main() {
  const [rootPath, command, ...extra] = process.argv.slice(2);
  if (
    !rootPath ||
    !["select", "read", "pause", "resume", "status"].includes(command) ||
    extra.length
  )
    fail("invalid_command");
  const root = await openLocalRoot(rootPath); // No default root: activation is always explicit.
  let result;
  if (["select", "resume"].includes(command)) {
    let text = "";
    for await (const chunk of process.stdin) {
      text += chunk;
      if (Buffer.byteLength(text) > 8192) fail("selection_too_large");
    }
    result = await (command === "select"
      ? selectTelemetrySource
      : resumeTelemetrySource)(root, JSON.parse(text));
  } else if (command === "read") result = await readSelectedTelemetry(root);
  else if (command === "pause") result = await pauseTelemetrySource(root);
  else result = await selectedReaderStatus(root);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`selected_reader_failed:${errorCode(error)}\n`);
    process.exitCode = 1;
  });
}
