#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_QUEUE_EVENTS = 10_000;
const TOKEN_ENV = "TIMER_CAPTURE_TOKEN";
const REJECTION_REASONS = [
  "outside_session",
  "future_timestamp",
  "id_conflict",
  "session_limit",
  "session_not_found",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const defaultConfigPath = join(
  homedir(),
  ".config",
  "timer",
  "codex",
  "config.json",
);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
function within(parent, child) {
  const part = relative(parent, child);
  return part === "" || (!part.startsWith("..") && !isAbsolute(part));
}

export function validateConfig(input) {
  const workLog = input?.mode === "work-log";
  if (input?.mode !== undefined && !workLog)
    throw new Error("Unsupported capture mode.");
  if (workLog && !UUID.test(input.userId))
    throw new Error("An account UUID is required.");
  if (!workLog && (!input || !UUID.test(input.sessionId)))
    throw new Error("A focus session UUID is required.");
  const url = new URL(input.apiOrigin);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "apiOrigin must be an origin without credentials or a path.",
    );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("Use HTTPS, or HTTP on localhost for development.");
  if (
    "captureToken" in input ||
    "token" in input ||
    "workLogToken" in input ||
    "accessToken" in input
  )
    throw new Error(`Keep the token out of config; use ${TOKEN_ENV}.`);
  if (
    input.shareAssistantSummary !== undefined &&
    typeof input.shareAssistantSummary !== "boolean"
  )
    throw new Error("shareAssistantSummary must be a boolean.");
  if (
    input.project !== undefined &&
    (!workLog ||
      typeof input.project !== "string" ||
      !input.project.trim() ||
      input.project.length > 200)
  )
    throw new Error(
      "project must be a nonempty string up to 200 characters in work-log mode.",
    );
  return {
    version: 1,
    apiOrigin: url.origin,
    ...(workLog
      ? {
          mode: "work-log",
          userId: input.userId.toLowerCase(),
          ...(input.project === undefined ? {} : { project: input.project }),
        }
      : { sessionId: input.sessionId.toLowerCase() }),
    shareAssistantSummary: input.shareAssistantSummary === true,
  };
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Expected a private directory.");
  if ((info.mode & 0o077) !== 0)
    throw new Error("Use a dedicated private directory with mode 700.");
}

async function readPrivateJson(path, maxBytes = MAX_INPUT_BYTES) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > maxBytes)
      throw new Error("Expected a bounded file with mode 600.");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function writeNewJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path); // Atomic publication; duplicate deliveries preserve the first timestamp.
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Another process may have linked the same receipt but not synced its
    // directory yet. Ensure publication is durable before callers delete data.
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return false;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function configure(configPath, input) {
  const config = validateConfig(input);
  configPath = resolve(configPath);
  // The checkout and its descendants are never a supported configuration destination.
  const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  if (within(checkout, configPath))
    throw new Error("Store configuration outside the repository.");
  await privateDirectory(dirname(configPath));
  if (
    within(
      await realpath(checkout),
      join(await realpath(dirname(configPath)), "config.json"),
    )
  )
    throw new Error("Store configuration outside the repository.");
  // Replace only after explicitly invoked configure; capture never edits configuration.
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(config, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const { rename } = await import("node:fs/promises");
  await rename(temporary, configPath);
  return config;
}

export async function loadConfig(configPath) {
  return validateConfig(await readPrivateJson(configPath));
}

function sourceId(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return /^[a-zA-Z0-9_-]{1,256}$/.test(value) ? value : `thread_${hash(value)}`;
}

function sanitizeSummary(value) {
  return value
    .replace(/(?:https?:\/\/)[^\s)\]>]+/gi, "[link omitted]")
    .replace(/(?:[a-zA-Z]:\\|~?\/)[^\s)\]>]+/g, "[path omitted]")
    .replace(
      /\b(?:sk-[\w-]+|Bearer\s+\S+|(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+)/gi,
      "[redacted]",
    )
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 1950);
}

function isCaptureCall(input) {
  const name = typeof input.tool_name === "string" ? input.tool_name : "";
  if (
    /mcp__timer[^_]*__.*(?:capture|work_events|log)/i.test(name) ||
    /mcp__.*work.?log.*(?:log|capture)/i.test(name)
  )
    return true;
  // Inspect only for exclusion; never store or transmit arguments.
  const command =
    input.tool_input?.command ??
    input.tool_input?.cmd ??
    input.tool_input?.code;
  return (
    typeof command === "string" &&
    /timer-capture\.mjs|local-helper\.mjs|integrations\/work-log|timer-work-log|\/api\/work-log\/events|\/api\/focus\/sessions\/[^\s]+\/work-events/.test(
      command,
    )
  );
}

export function eventFromHook(input, config, now = new Date()) {
  if (
    !input ||
    !["PostToolUse", "Stop"].includes(input.hook_event_name) ||
    isCaptureCall(input)
  )
    return null;
  const thread = sourceId(input.session_id);
  if (!thread) return null;
  const tool = input.hook_event_name === "PostToolUse";
  let summary = "Assistant turn completed.";
  if (tool) {
    const name =
      typeof input.tool_name === "string" &&
      /^[a-zA-Z0-9_.:-]{1,160}$/.test(input.tool_name)
        ? input.tool_name
        : "tool";
    const result = input.tool_response;
    let status = "";
    if (result && typeof result === "object" && !Array.isArray(result)) {
      if (
        result.isError === true ||
        (Number.isInteger(result.exit_code) && result.exit_code !== 0)
      )
        status = " (reported failure)";
      else if (result.isError === false || result.exit_code === 0)
        status = " (reported success)";
    }
    summary = `Tool completed: ${name}${status}.`;
  } else if (
    config.shareAssistantSummary &&
    typeof input.last_assistant_message === "string"
  ) {
    const shared = sanitizeSummary(input.last_assistant_message);
    if (shared) summary = `Agent-reported: ${shared}`;
  }
  const invocation = tool ? input.tool_use_id : input.turn_id;
  const digest =
    typeof invocation === "string" && invocation.length
      ? hash(
          `${config.apiOrigin}\0${config.mode === "work-log" ? `work-log\0${config.userId}` : config.sessionId}\0${thread}\0${input.hook_event_name}\0${invocation}`,
        )
      : null;
  const id = digest
    ? `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
    : randomUUID();
  return {
    id,
    source: "codex",
    sourceSessionId: thread,
    occurredAt: now.toISOString(),
    kind: tool ? "tool_completed" : "turn_completed",
    summary,
    ...(config.mode === "work-log" && config.project
      ? { project: config.project }
      : {}),
  };
}

function spoolRoot(configPath) {
  return join(dirname(resolve(configPath)), "spool");
}
function destination(config) {
  return hash(
    `${config.apiOrigin}\0${config.mode === "work-log" ? `work-log\0${config.userId}` : config.sessionId}`,
  );
}
function destinationFields(config) {
  return {
    apiOrigin: config.apiOrigin,
    ...(config.mode === "work-log"
      ? { mode: "work-log", userId: config.userId }
      : { sessionId: config.sessionId }),
  };
}
function spoolDirectory(configPath, config) {
  return join(spoolRoot(configPath), destination(config));
}

async function wasResolved(directory, id) {
  try {
    const receipt = await readPrivateJson(join(directory, `${id}.ack`), 128);
    if (receipt.id !== id || Object.keys(receipt).length !== 1)
      throw new Error("Invalid acknowledgment receipt.");
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    const rejected = await readPrivateJson(
      join(directory, `${id}.rejected`),
      16_384,
    );
    if (
      rejected.event?.id !== id ||
      !validQueuedEvent(rejected.event, rejected) ||
      !REJECTION_REASONS.includes(rejected.reason) ||
      destination(rejected) !== basename(directory)
    )
      throw new Error("Invalid rejection receipt.");
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function validateWorkLogEvent(event) {
  if (
    !event ||
    typeof event !== "object" ||
    !UUID.test(event.id) ||
    !["codex", "cli", "mcp"].includes(event.source)
  )
    return false;
  if (
    typeof event.sourceSessionId !== "string" ||
    !event.sourceSessionId.length ||
    event.sourceSessionId.length > 256
  )
    return false;
  if (
    typeof event.occurredAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.occurredAt) ||
    !Number.isFinite(Date.parse(event.occurredAt)) ||
    new Date(event.occurredAt).toISOString() !== event.occurredAt
  )
    return false;
  if (
    !["tool_completed", "turn_completed", "note"].includes(event.kind) ||
    typeof event.summary !== "string" ||
    !event.summary.trim() ||
    event.summary.length > 2000
  )
    return false;
  if (event.source === "codex" && event.kind === "note") return false;
  if (event.source !== "codex" && event.kind !== "note") return false;
  if (
    event.project !== undefined &&
    (typeof event.project !== "string" ||
      !event.project.trim() ||
      event.project.length > 200)
  )
    return false;
  if (event.sessionId !== undefined && !UUID.test(event.sessionId))
    return false;
  return Object.keys(event).every((key) =>
    [
      "id",
      "source",
      "sourceSessionId",
      "occurredAt",
      "kind",
      "summary",
      "project",
      "sessionId",
    ].includes(key),
  );
}

function validQueuedEvent(event, config = {}) {
  if (config.mode === "work-log") return validateWorkLogEvent(event);
  if (!event || !UUID.test(event.id) || event.source !== "codex") return false;
  if (
    typeof event.sourceSessionId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,256}$/.test(event.sourceSessionId)
  )
    return false;
  if (
    typeof event.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(event.occurredAt))
  )
    return false;
  if (
    !["tool_completed", "turn_completed"].includes(event.kind) ||
    typeof event.summary !== "string" ||
    !event.summary.length ||
    event.summary.length > 2000
  )
    return false;
  // This adapter never captures URLs or any additional payload fields.
  return Object.keys(event).length === 6;
}

export async function enqueue(configPath, config, event) {
  if (!event) return false;
  if (!validQueuedEvent(event, config)) throw new Error("Invalid work event.");
  const root = spoolRoot(configPath);
  await privateDirectory(root);
  const directory = spoolDirectory(configPath, config);
  await privateDirectory(directory);
  if (await wasResolved(directory, event.id)) return false;
  const files = await readdir(directory);
  if (
    files.filter(
      (name) =>
        name.endsWith(".json") ||
        (config.mode !== "work-log" && name.endsWith(".ack")) ||
        name.endsWith(".rejected"),
    ).length >= MAX_QUEUE_EVENTS
  )
    throw new Error(
      config.mode === "work-log"
        ? "Local work-log queue limit reached (10,000 pending or rejected events). Flush pending work and review rejected entries before capturing more."
        : "Local session event limit reached. Start a new focus session before capturing more.",
    );
  const path = join(directory, `${event.id}.json`);
  const published = await writeNewJson(path, {
    ...destinationFields(config),
    event,
  });
  // A concurrent flush may publish a receipt and remove the original while this
  // enqueue is publishing a duplicate. Do not leave that duplicate for retry.
  if (await wasResolved(directory, event.id)) {
    await unlink(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    return false;
  }
  return published;
}

export async function eventStatus(configPath, config, id) {
  if (typeof id !== "string" || !UUID.test(id))
    throw new Error("An event UUID is required.");
  const directory = spoolDirectory(configPath, config);
  if (await wasResolved(directory, id)) {
    try {
      const receipt = await readPrivateJson(join(directory, `${id}.ack`), 128);
      if (receipt.id !== id || Object.keys(receipt).length !== 1)
        throw new Error("Invalid acknowledgment receipt.");
      return { status: "acknowledged" };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const rejected = await readPrivateJson(
      join(directory, `${id}.rejected`),
      16_384,
    );
    return { status: "rejected", reason: rejected.reason };
  }
  try {
    const entry = await readPrivateJson(join(directory, `${id}.json`), 16_384);
    if (
      destination(entry) !== destination(config) ||
      entry.event?.id !== id ||
      !validQueuedEvent(entry.event, config)
    )
      throw new Error("Invalid queued event.");
    return { status: "queued" };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // Flush may have published a receipt between the initial check and read.
    if (await wasResolved(directory, id))
      return eventStatus(configPath, config, id);
    return { status: "missing" };
  }
}

export async function queueStatus(configPath, config) {
  const root = spoolRoot(configPath);
  const folders = await readdir(root).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  let currentSession = 0;
  let otherSessions = 0;
  let currentSessionRejected = 0;
  let otherSessionsRejected = 0;
  const counts = () =>
    Object.fromEntries(REJECTION_REASONS.map((reason) => [reason, 0]));
  const rejectedByReason = {
    currentSession: counts(),
    otherSessions: counts(),
  };
  for (const folder of folders.filter((name) => /^[a-f0-9]{64}$/.test(name))) {
    const files = await readdir(join(root, folder));
    const current = folder === destination(config);
    const count = files.filter((name) => name.endsWith(".json")).length;
    if (current) currentSession += count;
    else otherSessions += count;
    for (const name of files.filter(
      (name) => name.endsWith(".rejected") && UUID.test(name.slice(0, -9)),
    )) {
      const rejected = await readPrivateJson(join(root, folder, name), 16_384);
      if (
        !REJECTION_REASONS.includes(rejected.reason) ||
        rejected.event?.id !== name.slice(0, -9) ||
        !validQueuedEvent(rejected.event, rejected) ||
        destination(rejected) !== folder
      )
        throw new Error("Invalid rejection receipt.");
      rejectedByReason[current ? "currentSession" : "otherSessions"][
        rejected.reason
      ]++;
      if (current) currentSessionRejected++;
      else otherSessionsRejected++;
    }
  }
  return {
    currentSession,
    otherSessions,
    currentSessionRejected,
    otherSessionsRejected,
    rejectedByReason,
  };
}

export async function flush(
  configPath,
  config,
  {
    token = process.env[
      config.mode === "work-log" ? "TIMER_WORK_LOG_TOKEN" : TOKEN_ENV
    ],
    fetchImpl = fetch,
    maxBatches = 1,
    deliverEvents,
  } = {},
) {
  if (!token || /[\r\n]/.test(token))
    return { acknowledged: 0, quarantined: 0, reason: "token_missing" };
  const directory = spoolDirectory(configPath, config);
  const files = (
    await readdir(directory).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })
  )
    .filter((name) => UUID.test(name.slice(0, -5)) && name.endsWith(".json"))
    .sort();
  let acknowledged = 0;
  let quarantined = 0;
  let partial = false;
  if (config.mode === "work-log" && files.length) {
    try {
      const identity = await fetchImpl(
        `${config.apiOrigin}/api/work-log/identity`,
        {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(2000),
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!identity.ok)
        return {
          acknowledged,
          quarantined,
          reason:
            identity.status === 401
              ? "token_expired_or_revoked"
              : "server_rejected",
        };
      const body = await identity.json();
      if (body?.userId !== config.userId)
        return { acknowledged, quarantined, reason: "identity_mismatch" };
    } catch {
      return { acknowledged, quarantined, reason: "offline_or_unacknowledged" };
    }
  }
  for (
    let index = 0;
    index < files.length && index < maxBatches * 50;
    index += 50
  ) {
    const entries = [];
    for (const name of files.slice(index, index + 50)) {
      try {
        const entry = await readPrivateJson(join(directory, name), 16_384);
        if (
          entry.apiOrigin !== config.apiOrigin ||
          destination(entry) !== destination(config) ||
          entry.event?.id !== name.slice(0, -5) ||
          !validQueuedEvent(entry.event, config)
        )
          throw new Error("Invalid queued event.");
        // Check after reading: if another flusher already acknowledged an older
        // delivery, never send a newly published duplicate with a new timestamp.
        if (await wasResolved(directory, entry.event.id)) {
          await unlink(join(directory, name)).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
          continue;
        }
        entries.push({ name, event: entry.event });
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("An unreadable queued event needs local review.");
      }
    }
    if (!entries.length) continue;
    let response;
    try {
      response = deliverEvents
        ? null
        : await fetchImpl(
            config.mode === "work-log"
              ? `${config.apiOrigin}/api/work-log/events`
              : `${config.apiOrigin}/api/focus/sessions/${config.sessionId}/work-events`,
            {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(2000),
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                events: entries.map(({ event }) => event),
              }),
            },
          );
      if (response && !response.ok)
        return {
          acknowledged,
          quarantined,
          reason:
            response.status === 401
              ? "token_expired_or_revoked"
              : "server_rejected",
        };
      const body = deliverEvents
        ? await deliverEvents(entries.map(({ event }) => event))
        : await response.json();
      if (!body || typeof body !== "object")
        return { acknowledged, quarantined, reason: "invalid_acknowledgment" };
      const rejectedEvents =
        body.rejectedEvents === undefined ? [] : body.rejectedEvents;
      if (
        !Array.isArray(body.acceptedEventIds) ||
        !Array.isArray(rejectedEvents)
      )
        return { acknowledged, quarantined, reason: "invalid_acknowledgment" };
      const sent = new Set(entries.map(({ event }) => event.id));
      const accepted = new Set(body.acceptedEventIds);
      const rejected = new Map();
      // Validate the entire response before moving or deleting any queued file.
      // Unknown, duplicate, overlapping or malformed dispositions retain this batch.
      if (
        accepted.size !== body.acceptedEventIds.length ||
        [...accepted].some((id) => typeof id !== "string" || !sent.has(id))
      )
        return { acknowledged, quarantined, reason: "invalid_acknowledgment" };
      for (const entry of rejectedEvents) {
        if (
          !entry ||
          typeof entry.id !== "string" ||
          !sent.has(entry.id) ||
          accepted.has(entry.id) ||
          rejected.has(entry.id) ||
          !REJECTION_REASONS.includes(entry.reason)
        )
          return {
            acknowledged,
            quarantined,
            reason: "invalid_acknowledgment",
          };
        rejected.set(entry.id, entry.reason);
      }
      for (const { name, event } of entries) {
        if (accepted.has(event.id)) {
          // A durable content-free receipt must precede deletion. If interrupted,
          // either the original event remains or future delivery is suppressed.
          await writeNewJson(join(directory, `${event.id}.ack`), {
            id: event.id,
          });
          await unlink(join(directory, name)).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
          acknowledged += 1;
        } else if (rejected.has(event.id)) {
          // Preserve original evidence and destination; rejection is not delivery.
          await writeNewJson(join(directory, `${event.id}.rejected`), {
            ...destinationFields(config),
            event,
            reason: rejected.get(event.id),
          });
          await unlink(join(directory, name)).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
          quarantined += 1;
        }
      }
      if (
        entries.some(
          ({ event }) => !accepted.has(event.id) && !rejected.has(event.id),
        )
      )
        partial = true;
    } catch {
      return { acknowledged, quarantined, reason: "offline_or_unacknowledged" };
    }
  }
  return {
    acknowledged,
    quarantined,
    reason: partial ? "partial_acknowledgment" : "complete",
  };
}

async function stdinJson() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error("Input exceeds 1 MiB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const configIndex = args.indexOf("--config");
  const configPath =
    configIndex >= 0 ? args[configIndex + 1] : defaultConfigPath;
  if (!configPath) throw new Error("--config requires a path.");
  if (command === "configure" || command === "connect") {
    const config = await configure(configPath, await stdinJson());
    process.stdout.write(
      JSON.stringify({
        configured: true,
        sessionId: config.sessionId,
        ...(config.mode === "work-log"
          ? { mode: config.mode, userId: config.userId }
          : {}),
        tokenEnvironmentVariable:
          config.mode === "work-log" ? "TIMER_WORK_LOG_TOKEN" : TOKEN_ENV,
      }) + "\n",
    );
    return;
  }
  const config = await loadConfig(configPath);
  if (command === "capture") {
    const event = eventFromHook(await stdinJson(), config);
    if (event) {
      await enqueue(configPath, config, event);
      await flush(configPath, config);
    }
    process.stdout.write("{}\n");
  } else if (command === "flush") {
    process.stdout.write(
      JSON.stringify(await flush(configPath, config, { maxBatches: 5 })) + "\n",
    );
  } else if (command === "status") {
    process.stdout.write(
      JSON.stringify({
        sessionId: config.sessionId,
        ...(await queueStatus(configPath, config)),
        ...(config.mode === "work-log"
          ? { mode: config.mode, userId: config.userId }
          : {}),
        tokenAvailable: Boolean(
          process.env[
            config.mode === "work-log" ? "TIMER_WORK_LOG_TOKEN" : TOKEN_ENV
          ],
        ),
      }) + "\n",
    );
  } else throw new Error("Use configure, capture, flush, or status.");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    if (process.argv[2] === "capture") {
      // Never influence or block the agent loop, and never echo input/error details.
      process.stderr.write(
        "Timer capture skipped; run timer-capture.mjs status to check setup.\n",
      );
      process.stdout.write("{}\n");
    } else {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });
}
