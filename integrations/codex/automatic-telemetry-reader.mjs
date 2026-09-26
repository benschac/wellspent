// Scoped discovery only runs under a fresh native, process-bound lease. The existing
// selected reader remains the sole normalizer/journal/spool implementation.
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { canonicalTime, opaque, uuid } from "./local-contract.mjs";
import { optional, privateDirectory, retire } from "./local-helper.mjs";
import {
  READER_LIMITS,
  readSelectedTelemetry,
  replaceTelemetrySource,
  scopedTelemetryReader,
  selectedReaderStatus,
  stopSelectedTelemetry,
} from "./selected-telemetry-reader.mjs";

export const AUTOMATIC_LIMITS = Object.freeze({
  sources: 16,
  entries: 512,
  depth: 3,
  header: 64 * 1024,
  bytes: 64 * 1024 * 1024,
  durationMS: 8 * 60 * 60 * 1000,
  leaseMS: 15000,
});
const fail = (code) => {
  throw new Error(code);
};
const identity = (stat) => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
const physical = async (path, directory = false) => {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    (await realpath(path)) !== path
  )
    fail("source_path");
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    stat.uid !== process.getuid?.() ||
    !(stat.mode & 0o400) ||
    (directory && !(stat.mode & 0o100))
  )
    fail("source_permission");
  return stat;
};
const errorCodes = new Set([
  "api_unavailable",
  "api_timeout",
  "api_protocol",
  "api_session_limit",
  "api_response_limit",
  "api_source_missing",
  "api_session_not_loaded",
  "source_unavailable",
  "source_permission",
  "source_path",
  "source_replaced",
  "source_rewritten",
  "directory_replaced",
  "authorization_required",
  "overall_byte_limit",
  "discovery_memory_limit",
  "discovery_limit",
  "window_ended",
  "invalid_source_header",
  "unsupported_source_version",
  "queue_full",
  "identityConflict",
  "observation_limit",
  "fresh_binding_required",
  "source_already_selected",
  "reader_storage_limit",
  "storage_busy",
  "source_byte_limit",
]);
const safe = (error) =>
  ["ENOENT", "ELOOP"].includes(error?.code)
    ? "source_unavailable"
    : ["EACCES", "EPERM"].includes(error?.code)
      ? "source_permission"
      : errorCodes.has(error?.message)
        ? error.message
        : "reader_unavailable";

// On restart recover already-journaled metadata only, never reopen source paths.
export async function stopAutomaticReaders(root, reason, now) {
  const directory = join(root, "automatic-readers");
  await privateDirectory(directory);
  const handle = await opendir(directory);
  let count = 0;
  let failures = 0;
  for await (const entry of handle) {
    if (++count > 4096) fail("reader_storage_limit");
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    try {
      await stopSelectedTelemetry(
        scopedTelemetryReader(root, entry.name),
        reason,
        now,
      );
    } catch {
      // Keep the failed source journal and continue every other independent reader.
      failures++;
    }
  }
  return failures;
}

// Old automatic grants are no longer source-authorized after stop. Keep their
// keys while any publication or delivery still needs them, then reclaim slots.
export async function retireDrainedAutomaticBindings(root) {
  const directory = join(root, "automatic-readers");
  await privateDirectory(directory);
  const handle = await opendir(directory);
  let count = 0;
  for await (const entry of handle) {
    if (++count > 4096) fail("reader_storage_limit");
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const state = await optional(join(directory, entry.name, "state.json"));
    if (
      !state ||
      state.active ||
      state.journal ||
      typeof state.bindingID !== "string" ||
      !uuid.test(state.bindingID)
    )
      continue;
    try {
      await retire(root, state.bindingID);
    } catch (error) {
      if (
        !["binding_has_retained_packets", "unknown_binding"].includes(
          error.message,
        )
      )
        throw error;
    }
  }
}

export async function createAutomaticCapture({
  root,
  directoryPath,
  authorizationID,
  permitted,
  clock,
  discoverSessions = null,
}) {
  if (!(await permitted())) fail("authorization_required");
  if (typeof directoryPath !== "string" || !isAbsolute(directoryPath))
    fail("source_path");
  // Resolve only the one explicitly user-selected directory. Pin that physical
  // root for this activation; descendants must still be physical, not aliases.
  directoryPath = await realpath(resolve(directoryPath));
  const directoryIdentity = identity(await physical(directoryPath, true));
  const started = clock().getTime();
  const endsAt = new Date(started + AUTOMATIC_LIMITS.durationMS).toISOString();
  const entries = new Map();
  const ignored = new Map();
  const paths = new Map();
  const headerUsage = new Map();
  const counts = {};
  let bytesRead = 0;
  let enabled = true;
  let status = "collecting";
  let loadedSessionCount = 0;
  let apiPaths = new Map();
  const count = (code) => {
    counts[code] = (counts[code] ?? 0) + 1;
  };
  async function gate(path = directoryPath) {
    if (!enabled) fail("authorization_required");
    if (clock().getTime() >= Date.parse(endsAt)) {
      enabled = false;
      status = "window_ended";
      fail("window_ended");
    }
    if (!(await permitted())) {
      enabled = false;
      status = "expired";
      fail("authorization_required");
    }
    if (identity(await physical(directoryPath, true)) !== directoryIdentity)
      fail("directory_replaced");
    if (path !== directoryPath && !path.startsWith(`${directoryPath}/`))
      fail("source_path");
    if ((await realpath(path)) !== path) fail("source_path");
    return true;
  }
  async function stop(reason = "stopped") {
    enabled = false;
    status = reason;
    for (const entry of entries.values())
      if (entry.bindingID) {
        try {
          entry.reader = await stopSelectedTelemetry(
            scopedTelemetryReader(root, entry.sourceID),
            reason,
            clock(),
          );
        } catch {
          entry.failure = "reader_unavailable";
        }
      }
    return snapshot();
  }
  function reserve(length) {
    if (bytesRead + length > AUTOMATIC_LIMITS.bytes) fail("overall_byte_limit");
    bytesRead += length;
  }
  async function snapshot() {
    return {
      enabled,
      status,
      authorizationID,
      endsAt,
      bytesRead,
      maxBytes: AUTOMATIC_LIMITS.bytes,
      counts,
      ...(discoverSessions
        ? {
            discoveryMode: "appServer",
            loadedSessionCount,
            inScopeSessionCount: apiPaths.size,
          }
        : {}),
      candidates: [...entries.values()]
        .filter(
          (e) =>
            !e.bindingID &&
            !e.failure &&
            (!discoverSessions || apiPaths.get(e.filePath) === e.threadID),
        )
        .map(({ sourceID, threadID, sessionID, sourceVersion }) => ({
          sourceID,
          threadID,
          sessionID,
          sourceVersion,
        })),
      sources: [...entries.values()].map((e) => ({
        sourceID: e.sourceID,
        bindingID: e.bindingID ?? null,
        enabled:
          (e.reader?.enabled ?? false) &&
          (!discoverSessions || apiPaths.get(e.filePath) === e.threadID),
        status:
          e.failure ??
          (discoverSessions && apiPaths.get(e.filePath) !== e.threadID
            ? "not_loaded"
            : (e.reader?.status ?? "awaiting_binding")),
      })),
    };
  }
  async function examine(path, expectedThreadID = null) {
    await gate(path);
    const before = await physical(path);
    const priorIdentity = paths.get(path);
    if (priorIdentity && priorIdentity !== identity(before)) {
      count("source_replaced");
      return;
    }
    if (!priorIdentity) {
      if (paths.size >= AUTOMATIC_LIMITS.entries)
        fail("discovery_memory_limit");
      paths.set(path, identity(before));
    }
    const sourceID = createHash("sha256")
      .update(identity(before))
      .digest("hex");
    if (entries.has(sourceID) || ignored.has(sourceID)) return;
    if (ignored.size >= AUTOMATIC_LIMITS.entries)
      fail("discovery_memory_limit");
    if (entries.size >= AUTOMATIC_LIMITS.sources) {
      count("source_limit");
      return;
    }
    if (before.size === 0) return; // New/partial headers are retried, never treated as an enrollment.
    await gate(path);
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      if (identity(await handle.stat()) !== identity(before))
        fail("source_replaced");
      await gate(path); // Recheck physical ancestors after open and before reading.
      const limit = Math.min(before.size, AUTOMATIC_LIMITS.header);
      const bytes = Buffer.alloc(limit);
      let length = 0;
      let newline = -1;
      while (length < limit && newline < 0) {
        const amount = Math.min(256, limit - length);
        const consumed = headerUsage.get(sourceID) ?? 0;
        if (consumed + amount >= READER_LIMITS.totalBytes)
          fail("source_byte_limit");
        headerUsage.set(sourceID, consumed + amount);
        reserve(amount);
        await gate(path);
        if (identity(await lstat(path)) !== identity(before))
          fail("source_replaced");
        const { bytesRead: got } = await handle.read(
          bytes,
          length,
          amount,
          length,
        );
        if (!got) break;
        newline = bytes.subarray(length, length + got).indexOf(10);
        if (newline >= 0) newline += length;
        length += got;
      }
      if (identity(await lstat(path)) !== identity(before))
        fail("source_replaced");
      if (newline < 0) {
        if (length >= AUTOMATIC_LIMITS.header) {
          ignored.set(sourceID, "header_limit");
          count("header_limit");
        }
        return;
      }
      let header;
      try {
        header = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, newline),
          ),
        );
      } catch {
        fail("invalid_source_header");
      }
      const meta = header?.payload;
      if (
        header?.type !== "session_meta" ||
        !meta ||
        typeof meta.id !== "string" ||
        !opaque.test(meta.id) ||
        typeof (meta.session_id ?? meta.id) !== "string" ||
        !opaque.test(meta.session_id ?? meta.id)
      )
        fail("invalid_source_header");
      if (meta.cli_version !== "0.157.1") fail("unsupported_source_version");
      if (expectedThreadID !== null && meta.id !== expectedThreadID)
        fail("invalid_source_header");
      entries.set(sourceID, {
        sourceID,
        filePath: path,
        fileIdentity: identity(before),
        threadID: meta.id,
        sessionID: meta.session_id ?? meta.id,
        sourceVersion: meta.cli_version,
        headerBytes: headerUsage.get(sourceID),
        headerLength: newline + 1,
        headerDigest: createHash("sha256")
          .update(bytes.subarray(0, newline + 1))
          .digest("hex"),
      });
    } catch (error) {
      const code = safe(error);
      if (
        [
          "authorization_required",
          "overall_byte_limit",
          "directory_replaced",
        ].includes(code)
      )
        throw error;
      ignored.set(sourceID, code);
      count(code);
    } finally {
      await handle.close();
    }
  }
  async function discover() {
    try {
      await gate();
      if (discoverSessions) {
        apiPaths = new Map();
        if (bytesRead >= AUTOMATIC_LIMITS.bytes) fail("overall_byte_limit");
        const discovery = await discoverSessions({
          maxBytes: AUTOMATIC_LIMITS.bytes - bytesRead,
        });
        reserve(discovery.bytesRead);
        await gate();
        loadedSessionCount = discovery.loadedSessionCount;
        for (const source of discovery.sources) {
          if (source.path === null) {
            count("api_source_missing");
            continue;
          }
          if (!source.path.startsWith(`${directoryPath}/`)) continue;
          apiPaths.set(source.path, source.threadID);
          try {
            await examine(source.path, source.threadID);
          } catch (error) {
            const code = safe(error);
            if (
              [
                "source_unavailable",
                "source_permission",
                "source_path",
                "source_replaced",
              ].includes(code)
            )
              count(code);
            else throw error;
          }
        }
        return snapshot();
      }
      let visited = 0;
      async function walk(path, depth) {
        await gate(path);
        await physical(path, true);
        const handle = await opendir(path);
        for await (const entry of handle) {
          await gate(path);
          if (++visited > AUTOMATIC_LIMITS.entries) fail("discovery_limit");
          if (entry.isSymbolicLink()) {
            count("symlink_excluded");
            continue;
          }
          if (
            entry.isDirectory() &&
            depth < AUTOMATIC_LIMITS.depth &&
            /^\d{2,4}$/.test(entry.name)
          ) {
            try {
              await walk(join(path, entry.name), depth + 1);
            } catch (error) {
              const code = safe(error);
              if (
                [
                  "source_unavailable",
                  "source_permission",
                  "source_path",
                ].includes(code)
              )
                count(code);
              else throw error;
            }
          } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            try {
              await examine(join(path, entry.name));
            } catch (error) {
              const code = safe(error);
              if (
                [
                  "source_unavailable",
                  "source_permission",
                  "source_path",
                  "source_replaced",
                ].includes(code)
              )
                count(code);
              else throw error;
            }
          }
        }
      }
      await walk(directoryPath, 0);
    } catch (error) {
      const code = safe(error);
      count(code);
      if (code === "discovery_limit") {
        status = "discovery_limit";
      } else await stop(code === "authorization_required" ? "expired" : code);
    }
    return snapshot();
  }
  async function sourceGate(entry) {
    await gate(entry.filePath);
    if (discoverSessions && apiPaths.get(entry.filePath) !== entry.threadID)
      fail("api_session_not_loaded");
    if (identity(await lstat(entry.filePath)) !== entry.fileIdentity)
      fail("source_replaced");
    return true;
  }
  async function enroll(sourceID, bundle) {
    await gate();
    const entry = entries.get(sourceID);
    if (!entry || entry.failure) fail("invalid_source");
    if (entry.bindingID === bundle.binding.bindingID) return snapshot();
    if (entry.bindingID) fail("source_already_selected");
    if (bundle.binding.threadID !== entry.threadID) fail("binding_mismatch");
    // A persisted grant is not authority. Native must mint after this activation,
    // and each process/interval must use a new binding, never backdated access.
    if (
      !canonicalTime(bundle.binding.issuedAt) ||
      Date.parse(bundle.binding.issuedAt) < started
    )
      fail("fresh_binding_required");
    const scoped = scopedTelemetryReader(root, sourceID);
    const old = await optional(join(scoped.readerRoot, "state.json"));
    if (old?.bindingID === bundle.binding.bindingID)
      fail("fresh_binding_required");
    try {
      await sourceGate(entry);
      // The minimal identity header can change between discovery and native grant.
      // Confirm it before enrollment; append growth is allowed, header rewriting is not.
      const headerHandle = await open(
        entry.filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        if (identity(await headerHandle.stat()) !== entry.fileIdentity)
          fail("source_replaced");
        await sourceGate(entry);
        if (entry.headerBytes + entry.headerLength >= READER_LIMITS.totalBytes)
          fail("source_byte_limit");
        reserve(entry.headerLength);
        entry.headerBytes += entry.headerLength;
        const header = Buffer.alloc(entry.headerLength);
        const result = await headerHandle.read(header, 0, header.length, 0);
        if (
          result.bytesRead !== header.length ||
          createHash("sha256").update(header).digest("hex") !==
            entry.headerDigest
        )
          fail("source_rewritten");
      } finally {
        await headerHandle.close();
      }
      reserve(1);
      entry.reader = await replaceTelemetrySource(
        scoped,
        {
          ...entry,
          bindingID: bundle.binding.bindingID,
          endsAt,
          maxBytes: READER_LIMITS.totalBytes - entry.headerBytes,
        },
        clock(),
        () => sourceGate(entry),
      );
      entry.bindingID = bundle.binding.bindingID;
    } catch (error) {
      entry.failure = safe(error);
      count(entry.failure);
      if (
        [
          "authorization_required",
          "overall_byte_limit",
          "directory_replaced",
        ].includes(entry.failure)
      )
        await stop(
          entry.failure === "authorization_required"
            ? "expired"
            : entry.failure,
        );
    }
    return snapshot();
  }
  async function read() {
    try {
      if (discoverSessions) {
        await discover();
        if (!enabled) return snapshot();
      }
      await gate();
      for (const entry of entries.values())
        if (
          entry.bindingID &&
          !entry.failure &&
          entry.reader?.enabled &&
          (!discoverSessions || apiPaths.get(entry.filePath) === entry.threadID)
        ) {
          await gate();
          const prior = await selectedReaderStatus(
            scopedTelemetryReader(root, entry.sourceID),
          );
          // Reserve worst-case per-call IO before entering reader; reclaim unused bytes
          // only after a returned durable reader status. Process loss ends authority.
          const reservation = Math.min(
            READER_LIMITS.read + 256,
            Math.max(0, prior.maxBytes - prior.bytesRead),
          );
          reserve(reservation);
          try {
            entry.reader = await readSelectedTelemetry(
              scopedTelemetryReader(root, entry.sourceID),
              clock(),
              undefined,
              () => sourceGate(entry),
            );
            bytesRead -= Math.max(
              0,
              reservation - (entry.reader.bytesRead - prior.bytesRead),
            );
          } catch (error) {
            entry.failure = safe(error);
            count(entry.failure);
          }
        }
    } catch (error) {
      const code = safe(error);
      count(code);
      await stop(code === "authorization_required" ? "expired" : code);
    }
    if (enabled && !discoverSessions) await discover();
    return snapshot();
  }
  return { discover, enroll, read, stop, snapshot };
}
