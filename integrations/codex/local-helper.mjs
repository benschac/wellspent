#!/usr/bin/env node
// Opt-in loopback helper. No transcript reads, database access, or upload client.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  base64,
  bodyDigest,
  canonicalTime,
  decode,
  exactKeys,
  MAX_WIRE,
  metadataFromHook,
  opaque,
  rejectionReasons,
  sign,
  uuid,
  validateBundle,
  verify,
} from "./local-contract.mjs";

export const DEFAULT_ROOT = join(homedir(), ".config/wellspent/codex-local");
export const LIMITS = Object.freeze({
  pending: 1000,
  quarantine: 1000,
  receipts: 10000,
  bindings: 128,
  nonces: 4096,
  hook: 1024 * 1024,
});
const reasons = new Set([
  ...rejectionReasons,
  "unassociated",
  "missing_identity",
  "unsupported_hook",
  "self_capture",
  "queue_full",
  "pairing_unavailable",
]);
const directories = ["bindings", "pending", "quarantine", "receipts", "nonces"];
async function sync(directory) {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function privateDirectory(path) {
  const firstCreated = await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error("invalid_private_directory");
  if (firstCreated) {
    const parent = dirname(firstCreated);
    for (let current = path; ; current = dirname(current)) {
      await sync(current);
      if (current === parent) break;
    }
  }
}
async function read(path, limit = MAX_WIRE) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > limit
    )
      throw new Error("invalid_private_file");
    // Fixed read bound, including if a same-user writer grows the file after stat.
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit) throw new Error("invalid_private_file");
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, bytesRead),
      ),
    );
  } finally {
    await handle.close();
  }
}
async function optional(path) {
  try {
    return await read(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function remove(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function publish(path, value, replace = false) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_WIRE) throw new Error("packetTooLarge");
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (replace) await rename(temporary, path);
    else {
      try {
        await link(temporary, path);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    await sync(dirname(path));
  } finally {
    await remove(temporary);
  }
}
async function names(directory) {
  const result = (await readdir(directory)).filter(
    (name) => !name.startsWith("."),
  );
  if (result.length > LIMITS.receipts + LIMITS.nonces)
    throw new Error("directory_limit");
  return result;
}
function idPath(root, directory, id) {
  if (typeof id !== "string" || !uuid.test(id))
    throw new Error("invalid_identity");
  return join(root, directory, `${id.toLowerCase()}.json`);
}
// Publish a populated owner directory atomically. rename cannot replace a nonempty
// live lock. Reapers unlink only the observed unique owner file; rmdir cannot
// remove a newly acquired (always nonempty) lock even if another reaper raced.
async function lock(root, operation) {
  const lockPath = join(root, ".lock");
  const token = randomUUID();
  const ownerName = `${process.pid}-${token}.json`;
  const candidate = join(root, `.${process.pid}-${token}.lock`);
  await mkdir(candidate, { mode: 0o700 });
  await publish(join(candidate, ownerName), { pid: process.pid });
  let acquired = false;
  async function release(directory, owner) {
    await remove(join(directory, owner));
    try {
      await rmdir(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    }
  }
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        await rename(candidate, lockPath);
        acquired = true;
        break;
      } catch (error) {
        if (!["ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
      }
      let owners;
      try {
        owners = await readdir(lockPath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (owners.length > 1) throw new Error("invalid_lock");
      const prior = owners[0];
      if (prior) {
        const match = /^(\d+)-[a-f0-9-]{36}\.json$/.exec(prior);
        if (!match || Number(match[1]) < 1) throw new Error("invalid_lock");
        let alive = true;
        try {
          process.kill(Number(match[1]), 0);
        } catch (error) {
          if (error.code === "ESRCH") alive = false;
        }
        if (!alive) await release(lockPath, prior);
      }
      await new Promise((done) => setTimeout(done, 10));
    }
    if (!acquired) throw new Error("storage_busy");
    return await operation();
  } finally {
    if (acquired) await release(lockPath, ownerName);
    else await release(candidate, ownerName);
  }
}
export async function openLocalRoot(directory = DEFAULT_ROOT) {
  const root = resolve(directory);
  const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  if (root === checkout || root.startsWith(`${checkout}/`))
    throw new Error("root_inside_repository");
  await privateDirectory(root);
  const physical = await realpath(root);
  const actualCheckout = await realpath(checkout);
  if (
    physical !== root ||
    physical === actualCheckout ||
    physical.startsWith(`${actualCheckout}/`)
  )
    throw new Error("invalid_root");
  for (const child of directories) await privateDirectory(join(root, child));
  return root;
}
export async function identity(root) {
  return lock(root, async () => {
    await publish(join(root, "identity.json"), { senderID: randomUUID() });
    const value = await read(join(root, "identity.json"));
    if (!exactKeys(value, ["senderID"]) || !opaque.test(value.senderID))
      throw new Error("invalid_identity");
    return value;
  });
}
export async function setup(root, input) {
  const bundle = validateBundle(input);
  return lock(root, async () => {
    const current = await optional(join(root, "identity.json"));
    if (current && current.senderID !== bundle.binding.senderID)
      throw new Error("sender_mismatch");
    // First setup may adopt the native-issued stable sender identity.
    await publish(join(root, "identity.json"), {
      senderID: bundle.binding.senderID,
    });
    const bindings = await loadBindings(root);
    if (bindings.some((b) => b.endpoint !== bundle.endpoint))
      throw new Error("endpoint_mismatch");
    const path = idPath(root, "bindings", bundle.binding.bindingID);
    const existing = await optional(path);
    if (existing && JSON.stringify(existing) !== JSON.stringify(bundle))
      throw new Error("binding_conflict");
    if (!existing && bindings.length >= LIMITS.bindings)
      throw new Error("binding_limit");
    await publish(path, bundle);
    return {
      paired: true,
      senderID: bundle.binding.senderID,
      threadID: bundle.binding.threadID,
      bindingID: bundle.binding.bindingID,
      endpoint: bundle.endpoint,
    };
  });
}
async function loadBindings(root) {
  const files = await names(join(root, "bindings"));
  if (files.length > LIMITS.bindings) throw new Error("binding_limit");
  return Promise.all(
    files.map(async (name) =>
      validateBundle(await read(join(root, "bindings", name))),
    ),
  );
}
async function countReason(root, reason) {
  if (!reasons.has(reason)) throw new Error("invalid_reason");
  const counts = (await optional(join(root, "counts.json"))) ?? {};
  counts[reason] = Math.min(1000000000, (counts[reason] ?? 0) + 1);
  await publish(join(root, "counts.json"), counts, true);
}
export async function capture(root, input, receivedAt = new Date()) {
  return lock(root, async () => {
    const bindings = await loadBindings(root);
    const selected = bindings
      .filter(
        (b) =>
          b.binding.threadID === input?.session_id &&
          Date.parse(b.binding.issuedAt) <= receivedAt.getTime(),
      )
      .sort((a, b) => b.binding.issuedAt.localeCompare(a.binding.issuedAt))[0];
    const metadata = metadataFromHook(input, selected?.binding, receivedAt);
    if (metadata.reason) {
      await countReason(root, metadata.reason);
      return { queued: false, reason: metadata.reason };
    }
    const id = metadata.eventID;
    if (
      (await optional(idPath(root, "receipts", id))) ||
      (await optional(idPath(root, "quarantine", id)))
    )
      return { queued: false, duplicate: true };
    if (await optional(idPath(root, "pending", id)))
      return { queued: true, duplicate: true };
    if ((await names(join(root, "pending"))).length >= LIMITS.pending) {
      await countReason(root, "queue_full");
      return { queued: false, reason: "queue_full" };
    }
    if (!selected) throw new Error("pairing_unavailable");
    await publish(
      idPath(root, "pending", id),
      sign(metadata, base64(selected.key, 32)),
    );
    return { queued: true, eventID: id };
  });
}
export async function status(root) {
  const counts = (await optional(join(root, "counts.json"))) ?? {};
  const safeCounts = {};
  for (const [reason, count] of Object.entries(counts)) {
    if (
      !reasons.has(reason) ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > 1000000000
    )
      throw new Error("invalid_status");
    safeCounts[reason] = count;
  }
  const pending = (await names(join(root, "pending"))).length;
  const quarantine = await names(join(root, "quarantine"));
  for (const name of quarantine) {
    const entry = await read(join(root, "quarantine", name));
    if (!rejectionReasons.has(entry.reason)) throw new Error("invalid_reason");
    safeCounts[entry.reason] = (safeCounts[entry.reason] ?? 0) + 1;
  }
  return {
    pending,
    quarantined: quarantine.length,
    unassociated: counts.unassociated ?? 0,
    reasons: safeCounts,
  };
}
async function authenticateRequest(root, packet, domain, now) {
  const { value } = decode(packet);
  if (!value || typeof value.bindingID !== "string")
    throw new Error("invalidPacket");
  const bundle = validateBundle(
    await read(idPath(root, "bindings", value.bindingID)),
  );
  verify(packet, base64(bundle.key, 32), domain);
  const keys =
    domain === "reject"
      ? [
          "version",
          "bindingID",
          "eventID",
          "bodyDigest",
          "reason",
          "nonce",
          "issuedAt",
        ]
      : ["version", "bindingID", "nonce", "issuedAt"];
  if (
    !exactKeys(value, keys) ||
    value.version !== 1 ||
    !uuid.test(value.nonce) ||
    !canonicalTime(value.issuedAt) ||
    Math.abs(now.getTime() - Date.parse(value.issuedAt)) > 30000
  )
    throw new Error("stale_request");
  const noncePath = idPath(root, "nonces", value.nonce);
  if (await optional(noncePath)) throw new Error("replayed_request");
  for (const file of await names(join(root, "nonces"))) {
    const path = join(root, "nonces", file);
    const prior = await read(path);
    if (
      canonicalTime(prior.issuedAt) &&
      now.getTime() - Date.parse(prior.issuedAt) > 60000
    )
      await remove(path);
  }
  if ((await names(join(root, "nonces"))).length >= LIMITS.nonces)
    throw new Error("nonce_limit");
  await publish(noncePath, { issuedAt: value.issuedAt });
  return { value, bundle };
}
export async function dispatch(root, path, packet, now = new Date()) {
  return lock(root, async () => {
    if (path === "/v1/ack") {
      const receipt = decode(packet).value;
      if (
        !exactKeys(receipt, ["eventID", "bodyDigest", "nativeReceivedAt"]) ||
        !uuid.test(receipt.eventID) ||
        !/^[0-9a-f]{64}$/.test(receipt.bodyDigest) ||
        !canonicalTime(receipt.nativeReceivedAt)
      )
        throw new Error("invalidPacket");
      const pendingPath = idPath(root, "pending", receipt.eventID);
      const pending = await optional(pendingPath);
      if (!pending) {
        if (!(await optional(idPath(root, "receipts", receipt.eventID))))
          throw new Error("unknown_event");
        const bindings = await loadBindings(root);
        if (
          !bindings.some((bundle) => {
            try {
              verify(packet, base64(bundle.key, 32), "ack");
              return true;
            } catch {
              return false;
            }
          })
        )
          throw new Error("untrustedSender");
        return { ok: true };
      }
      const metadata = decode(pending).value;
      const bundle = validateBundle(
        await read(idPath(root, "bindings", metadata.bindingID)),
      );
      verify(packet, base64(bundle.key, 32), "ack");
      if (bodyDigest(pending) !== receipt.bodyDigest)
        throw new Error("mismatched_ack");
      if (
        (await names(join(root, "receipts"))).length >= LIMITS.receipts &&
        !(await optional(idPath(root, "receipts", receipt.eventID)))
      )
        throw new Error("receipt_limit");
      await publish(idPath(root, "receipts", receipt.eventID), {
        id: receipt.eventID,
      });
      await remove(pendingPath);
      await sync(join(root, "pending"));
      return { ok: true };
    }
    const domain =
      path === "/v1/poll"
        ? "poll"
        : path === "/v1/status"
          ? "status"
          : path === "/v1/reject"
            ? "reject"
            : null;
    if (!domain) throw new Error("invalid_path");
    const { value, bundle } = await authenticateRequest(
      root,
      packet,
      domain,
      now,
    );
    if (domain === "status") return status(root);
    if (domain === "reject") {
      if (
        !uuid.test(value.eventID) ||
        !/^[0-9a-f]{64}$/.test(value.bodyDigest) ||
        !rejectionReasons.has(value.reason)
      )
        throw new Error("invalidPacket");
      const pendingPath = idPath(root, "pending", value.eventID);
      const pending = await optional(pendingPath);
      if (!pending) {
        const prior = await optional(idPath(root, "quarantine", value.eventID));
        if (
          prior &&
          bodyDigest(prior.packet) === value.bodyDigest &&
          decode(prior.packet).value.bindingID.toLowerCase() ===
            value.bindingID.toLowerCase()
        )
          return { ok: true };
        throw new Error("unknown_event");
      }
      if (
        bodyDigest(pending) !== value.bodyDigest ||
        decode(pending).value.bindingID.toLowerCase() !==
          value.bindingID.toLowerCase()
      )
        throw new Error("mismatched_rejection");
      if ((await names(join(root, "quarantine"))).length >= LIMITS.quarantine)
        throw new Error("quarantine_limit");
      await publish(idPath(root, "quarantine", value.eventID), {
        reason: value.reason,
        packet: pending,
      });
      await remove(pendingPath);
      await sync(join(root, "pending"));
      return { ok: true };
    }
    let next = null;
    for (const name of (await names(join(root, "pending"))).sort()) {
      const pendingPath = join(root, "pending", name);
      const candidate = await read(pendingPath);
      const metadata = decode(candidate).value;
      if (
        (await optional(idPath(root, "receipts", metadata.eventID))) ||
        (await optional(idPath(root, "quarantine", metadata.eventID)))
      ) {
        await remove(pendingPath);
        await sync(join(root, "pending"));
        continue;
      }
      if (
        metadata.bindingID.toLowerCase() ===
        bundle.binding.bindingID.toLowerCase()
      ) {
        verify(candidate, base64(bundle.key, 32), "event");
        next = candidate;
        break;
      }
    }
    return { packet: next, status: await status(root) };
  });
}
// Explicit owner-invoked key retirement, after native revocation. Never inferred
// from a deadline: pending or quarantined diagnostics must be handled first.
export async function retire(root, bindingID) {
  const path = idPath(root, "bindings", bindingID);
  return lock(root, async () => {
    const bundle = await optional(path);
    if (!bundle) throw new Error("unknown_binding");
    validateBundle(bundle);
    for (const category of ["pending", "quarantine"]) {
      for (const name of await names(join(root, category))) {
        const entry = await read(join(root, category, name));
        const packet = category === "quarantine" ? entry.packet : entry;
        const metadata = decode(packet).value;
        if (typeof metadata.bindingID !== "string")
          throw new Error("invalidPacket");
        if (metadata.bindingID.toLowerCase() === bindingID.toLowerCase())
          throw new Error("binding_has_retained_packets");
      }
    }
    await remove(path);
    await sync(join(root, "bindings"));
    return { retired: bindingID.toLowerCase() };
  });
}
export async function cleanup(root, kind) {
  if (!["quarantine", "receipts", "temporary", "counts"].includes(kind))
    throw new Error("invalid_cleanup");
  return lock(root, async () => {
    let removed = 0;
    if (kind === "counts") {
      await publish(join(root, "counts.json"), {}, true);
      return { removed: 0 };
    }
    for (const dir of kind === "temporary"
      ? [root, ...directories.map((d) => join(root, d))]
      : [join(root, kind)]) {
      for (const name of await readdir(dir)) {
        const orphan =
          kind === "temporary" && dir === root
            ? /^\.(\d+)-[a-f0-9-]{36}\.lock$/.exec(name)
            : null;
        if (orphan && Number(orphan[1]) > 0) {
          let alive = true;
          try {
            process.kill(Number(orphan[1]), 0);
          } catch (error) {
            if (error.code === "ESRCH") alive = false;
          }
          if (!alive) {
            await rm(join(dir, name), { recursive: true, force: true });
            removed++;
          }
          continue;
        }
        if (
          kind === "temporary"
            ? /^\.[a-f0-9-]+\.tmp$/.test(name)
            : /^[a-f0-9-]+\.json$/.test(name)
        ) {
          await remove(join(dir, name));
          removed++;
        }
      }
      await sync(dir);
    }
    return { removed };
  });
}
export async function serve(root) {
  const bindings = await loadBindings(root);
  const endpoint = bindings[0]?.endpoint;
  if (!endpoint || bindings.some((b) => b.endpoint !== endpoint))
    throw new Error("pairing_unavailable");
  const url = new URL(endpoint);
  const server = createServer(
    {
      maxHeaderSize: 4096,
      requestTimeout: 5000,
      headersTimeout: 5000,
      connectionsCheckingInterval: 1000,
    },
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Connection", "close");
      try {
        if (
          request.socket.remoteAddress !== "127.0.0.1" ||
          request.headers.host !== url.host ||
          request.method !== "POST" ||
          !["/v1/poll", "/v1/ack", "/v1/reject", "/v1/status"].includes(
            request.url,
          ) ||
          request.headers.origin ||
          request.headers["content-encoding"] ||
          request.headers["content-type"] !== "application/json"
        )
          throw new Error("invalid_request");
        if (
          request.headers["content-length"] &&
          (!/^\d+$/.test(request.headers["content-length"]) ||
            Number(request.headers["content-length"]) > MAX_WIRE)
        )
          throw new Error("packetTooLarge");
        request.setTimeout(5000, () => request.destroy());
        const parts = [];
        let size = 0;
        for await (const part of request) {
          size += part.length;
          if (size > MAX_WIRE) throw new Error("packetTooLarge");
          parts.push(part);
        }
        const packet = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(parts),
          ),
        );
        const result = await dispatch(root, request.url, packet);
        response.writeHead(200);
        response.end(JSON.stringify(result));
      } catch (error) {
        // Never echo request data, filesystem paths, keys, or arbitrary exception messages.
        const transient =
          [
            "storage_busy",
            "nonce_limit",
            "receipt_limit",
            "quarantine_limit",
          ].includes(error.message) || typeof error.code === "string";
        response.writeHead(transient ? 503 : 400);
        response.end(
          JSON.stringify({
            error: transient ? "temporarily_unavailable" : "rejected_request",
          }),
        );
      }
    },
  );
  server.on("connection", (socket) =>
    socket.setTimeout(5000, () => socket.destroy()),
  );
  server.maxConnections = 16;
  server.keepAliveTimeout = 1;
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(Number(url.port), "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  return server;
}
async function stdin(limit) {
  let size = 0;
  const parts = [];
  for await (const part of process.stdin) {
    size += part.length;
    if (size > limit) throw new Error("inputTooLarge");
    parts.push(part);
  }
  const bytes = Buffer.concat(parts);
  if (bytes.toString("utf8").trim().length === 0)
    throw new Error("empty_input");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    // JSON parser errors may include the private input itself. Never forward them.
    throw new Error("invalid_json_input");
  }
}
// One bounded, private checkpoint, separate from the native status wire contract.
// Never persist raw input or exception text, including JSON parser/OS messages.
const captureErrors = new Set([
  "empty_input",
  "invalid_json_input",
  "inputTooLarge",
  "invalid_private_directory",
  "invalid_private_file",
  "invalid_root",
  "root_inside_repository",
  "storage_busy",
  "invalid_lock",
  "invalid_pairing",
  "binding_limit",
  "directory_limit",
  "packetTooLarge",
]);
function captureErrorCode(error) {
  if (captureErrors.has(error?.message)) return error.message;
  if (["EACCES", "EPERM"].includes(error?.code)) return "storage_denied";
  if (error?.code === "ENOSPC") return "storage_full";
  return "capture_unavailable";
}
async function captureCheckpoint(root, diagnostic) {
  try {
    await publish(join(root, "capture-diagnostic.json"), diagnostic, true);
  } catch {
    // Diagnostics must never prevent durable capture or affect hook output.
    process.stderr.write("wellspent_capture:diagnostic_unavailable\n");
  }
}
async function captureStdin(root, receivedAt) {
  const diagnostic = {
    version: 1,
    attemptID: randomUUID(),
    pid: process.pid,
    receivedAt: receivedAt.toISOString(),
    stage: "stdin",
    code: "waiting_for_input",
  };
  await captureCheckpoint(root, diagnostic);
  try {
    const input = await stdin(LIMITS.hook);
    diagnostic.stage = "capture";
    diagnostic.code = "input_parsed";
    // IDs and hook names only; invalid/missing IDs remain absent.
    for (const [key, value] of Object.entries({
      threadID: input?.session_id,
      turnID: input?.turn_id,
      invocationID:
        input?.hook_event_name === "Stop" ? input?.turn_id : input?.tool_use_id,
    })) {
      if (typeof value === "string" && opaque.test(value))
        diagnostic[key] = value;
    }
    if (["PostToolUse", "Stop"].includes(input?.hook_event_name))
      diagnostic.kind = input.hook_event_name;
    await captureCheckpoint(root, diagnostic);
    const result = await capture(root, input, receivedAt);
    diagnostic.stage = "complete";
    diagnostic.code = result.duplicate
      ? "duplicate"
      : result.queued
        ? "queued"
        : result.reason;
    if (result.eventID) diagnostic.eventID = result.eventID;
    await captureCheckpoint(root, diagnostic);
  } catch (error) {
    diagnostic.code = captureErrorCode(error);
    await captureCheckpoint(root, diagnostic);
    throw error;
  }
}
async function main() {
  const args = process.argv.slice(2);
  const directory = args[0] === "--root" ? args.splice(0, 2)[1] : DEFAULT_ROOT;
  const [command, kind] = args;
  if (command === "setup" && args.length > 1)
    throw new Error("setup_stdin_required");
  if (
    ![
      "identity",
      "setup",
      "capture",
      "serve",
      "status",
      "cleanup",
      "retire",
    ].includes(command) ||
    args.length > (["cleanup", "retire"].includes(command) ? 2 : 1)
  )
    throw new Error("invalid_command");
  const receivedAt = new Date();
  const root = await openLocalRoot(directory);
  let result;
  if (command === "identity") result = await identity(root);
  else if (command === "setup")
    result = await setup(root, await stdin(MAX_WIRE));
  else if (command === "capture") {
    await captureStdin(root, receivedAt);
    result = {};
  } else if (command === "status")
    result = await lock(root, () => status(root));
  else if (command === "cleanup") result = await cleanup(root, kind);
  else if (command === "retire") result = await retire(root, kind);
  else {
    const server = await serve(root);
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => {
        server.close();
        server.closeAllConnections();
      });
    process.stdout.write(
      "Local-only helper listening on paired loopback endpoint.\n",
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const capturing = process.argv.includes("capture");
    const setupErrors = {
      setup_stdin_required:
        "Setup takes no arguments. Copy the full pairing JSON from Timer, then run: pbpaste | node integrations/codex/local-helper.mjs setup",
      empty_input:
        "Setup received no input. Copy the full pairing JSON from Timer, then run: pbpaste | node integrations/codex/local-helper.mjs setup",
      invalid_json_input:
        "Setup input is not valid JSON. Copy only the full pairing JSON from Timer, without terminal commands, prompts, or code fences.",
      inputTooLarge: "Setup input exceeds the 16 KiB pairing limit.",
      invalid_pairing:
        "Setup input is not a complete supported Timer pairing bundle. Copy the full JSON from Create pairing.",
      invalidPacket:
        "The pairing key is invalid. Copy the complete pairing bundle from Timer again.",
      invalid_endpoint:
        "The pairing endpoint must be a literal local loopback address and port.",
      sender_mismatch:
        "The bundle sender ID differs from this helper's identity. Create a new Timer pairing using the sender ID from the identity command.",
      binding_conflict:
        "This binding already has different saved pairing data. Create a new pairing; existing data was preserved.",
      endpoint_mismatch:
        "This helper already has bindings for another port. Use that port or retire the old bindings first.",
    };
    const message = capturing
      ? `wellspent_capture:${captureErrorCode(error)}`
      : process.argv.includes("setup") &&
          Object.hasOwn(setupErrors, error.message)
        ? setupErrors[error.message]
        : "Local Codex intake unavailable; inspect local status/setup.";
    process.stderr.write(`${message}\n`);
    if (capturing) process.stdout.write("{}\n");
    else process.exitCode = 1;
  });
}
