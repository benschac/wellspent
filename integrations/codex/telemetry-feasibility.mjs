// Offline feasibility primitives, deliberately disconnected from hooks, spool,
// SQLite and private session files. This is not an enabled source adapter.
export const telemetrySourceVersion = "0.157.1";

const usageKeys = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];
const identityKeys = [
  "thread_id",
  "turn_id",
  "session_id",
  "root_turn_id",
  "response_id",
];
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isID = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);

/** Normalize one already-selected synthetic rollout item; never read a file. */
export function normalizeTelemetryFixture(
  item,
  version = telemetrySourceVersion,
) {
  if (version !== telemetrySourceVersion)
    return { status: "unsupported-version" };
  if (!isObject(item)) return { status: "invalid-record" };
  if (item.type !== "token_usage_record")
    return { status: "non-accounting-record" };
  const record = item.payload;
  if (!isObject(record) || !identityKeys.every((key) => isID(record[key]))) {
    return { status: "invalid-identity" };
  }
  if (!isObject(record.usage)) return { status: "usage-unavailable" };
  const usage = {};
  for (const key of usageKeys) {
    const value = record.usage[key];
    // An omitted optional subset stays unknown, even where upstream defaults it.
    if (key === "cache_write_input_tokens" && value === undefined) {
      usage[key] = null;
    } else if (Number.isSafeInteger(value) && value >= 0) {
      usage[key] = value;
    } else {
      return { status: "invalid-usage" };
    }
  }
  if (
    !Number.isSafeInteger(usage.input_tokens + usage.output_tokens) ||
    usage.input_tokens + usage.output_tokens !== usage.total_tokens ||
    usage.cached_input_tokens > usage.input_tokens ||
    usage.reasoning_output_tokens > usage.output_tokens ||
    (usage.cache_write_input_tokens !== null &&
      usage.cache_write_input_tokens > usage.input_tokens)
  )
    return { status: "inconsistent-usage" };
  return {
    status: "observed",
    source: "codex-rollout",
    sourceVersion: version,
    identity: Object.fromEntries(identityKeys.map((key) => [key, record[key]])),
    usage,
    counterMode: "response-increment",
    coverage: "partial",
    executedModel: null,
    executedEffort: null,
    taskID: null,
  };
}

/**
 * Rebuild a partial observed total. Copied/resumed records retain original
 * identity; a conflicting identity excludes every variant, independent of order.
 * Cumulative diagnostics, wrapper time, configured model and task never join it.
 */
export function summarizeTelemetryFixtures(
  items,
  version = telemetrySourceVersion,
) {
  const atoms = new Map();
  const issues = [];
  for (const item of items) {
    const atom = normalizeTelemetryFixture(item, version);
    if (atom.status !== "observed") {
      issues.push(atom.status);
      continue;
    }
    const key = JSON.stringify([
      atom.source,
      atom.identity.thread_id,
      atom.identity.response_id,
    ]);
    const signature = JSON.stringify([atom.identity, atom.usage]);
    const existing = atoms.get(key);
    if (existing) {
      if (existing.signature !== signature) existing.conflict = true;
    } else {
      atoms.set(key, { signature, atom, conflict: false });
    }
  }
  let total = 0;
  let observedResponses = 0;
  let conflicts = 0;
  for (const entry of atoms.values()) {
    if (entry.conflict) {
      conflicts += 1;
      continue;
    }
    total += entry.atom.usage.total_tokens;
    observedResponses += 1;
  }
  const overflow = !Number.isSafeInteger(total);
  if (overflow) issues.push("total-overflow");
  return {
    observedTotalTokens: observedResponses === 0 || overflow ? null : total,
    observedResponses,
    conflicts,
    issues: [...new Set(issues)].sort(),
    coverage: "partial",
    unallocated: true,
  };
}
