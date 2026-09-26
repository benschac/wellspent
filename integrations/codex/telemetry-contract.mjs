// Allowlisted telemetry transport shared by fixtures and the explicitly selected source reader.
import { createHash } from "node:crypto";
import { canonicalTime, exactKeys, opaque, uuid } from "./local-contract.mjs";

export const TELEMETRY_CAPABILITY = "codex-telemetry-v1";
export const TELEMETRY_PREVIEW_CAPABILITY = "codex-telemetry-preview-v1";
export const TELEMETRY_PREVIEW_LIMITS = Object.freeze({
  packets: 16,
  bytes: 128 * 1024,
});
const identities = ["sessionID", "rootTurnID", "turnID"];
const usageKeys = [
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
];
const keys = [
  "version",
  "observationID",
  "senderID",
  "bindingID",
  "localScopeID",
  "recordingID",
  "intervalID",
  "source",
  "sourceVersion",
  "threadID",
  ...identities,
  "responseID",
  "kind",
  "sourceWrittenAt",
  "helperReceivedAt",
  "timeBasis",
  "configuredModel",
  "configuredEffort",
  "usage",
  "counterMode",
  "coverage",
];
const label = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_.-]{1,160}$/.test(value);
const optionalLabel = (value) => value === null || label(value);
const amount = (value) => Number.isSafeInteger(value) && value >= 0;

export function telemetryIdentity(value) {
  const parts = [
    "wellspent-codex-telemetry-v1",
    value.senderID,
    value.threadID,
    value.sessionID,
    value.rootTurnID,
    value.turnID,
    value.kind,
    value.responseID ?? "",
  ];
  const h = createHash("sha256").update(parts.join("\0")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function validateTelemetry(value) {
  if (
    !exactKeys(value, keys) ||
    value.version !== 1 ||
    value.source !== "codex-rollout" ||
    value.sourceVersion !== "0.157.1" ||
    !uuid.test(value.observationID) ||
    ![value.bindingID, value.recordingID, value.intervalID].every((id) =>
      uuid.test(id),
    ) ||
    ![
      value.senderID,
      value.threadID,
      ...identities.map((id) => value[id]),
    ].every((id) => opaque.test(id)) ||
    typeof value.localScopeID !== "string" ||
    value.localScopeID.length < 1 ||
    Buffer.byteLength(value.localScopeID) > 200 ||
    [...value.localScopeID].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    ) ||
    !canonicalTime(value.sourceWrittenAt) ||
    !canonicalTime(value.helperReceivedAt) ||
    value.timeBasis !== "sourceWrite" ||
    value.coverage !== "partial" ||
    value.observationID.toLowerCase() !== telemetryIdentity(value)
  )
    throw new Error("invalidPacket");
  if (value.kind === "turnConfiguration") {
    if (
      value.responseID !== null ||
      value.usage !== null ||
      value.counterMode !== "none" ||
      !optionalLabel(value.configuredModel) ||
      !optionalLabel(value.configuredEffort)
    )
      throw new Error("invalidPacket");
  } else if (value.kind === "responseUsage") {
    if (
      !opaque.test(value.responseID) ||
      value.configuredModel !== null ||
      value.configuredEffort !== null ||
      value.counterMode !== "responseIncrement" ||
      !exactKeys(value.usage, usageKeys) ||
      !usageKeys.every(
        (key) =>
          (value.usage[key] === null && key === "cacheWriteInputTokens") ||
          amount(value.usage[key]),
      )
    )
      throw new Error("invalidPacket");
    const u = value.usage;
    if (
      u.inputTokens + u.outputTokens !== u.totalTokens ||
      !amount(u.totalTokens) ||
      u.cachedInputTokens > u.inputTokens ||
      u.reasoningOutputTokens > u.outputTokens ||
      (u.cacheWriteInputTokens !== null &&
        u.cacheWriteInputTokens > u.inputTokens)
    )
      throw new Error("invalidPacket");
  } else throw new Error("invalidPacket");
  return value;
}

export function telemetryFromSynthetic(
  input,
  binding,
  receivedAt = new Date(),
) {
  // Only callers holding an explicit native pairing bundle can enqueue; this never opens a source file.
  const value = {
    version: 1,
    observationID: "",
    senderID: binding.senderID,
    bindingID: binding.bindingID,
    localScopeID: binding.localScopeID,
    recordingID: binding.recordingID,
    intervalID: binding.intervalID,
    source: "codex-rollout",
    sourceVersion: input.sourceVersion,
    threadID: binding.threadID,
    sessionID: input.sessionID,
    rootTurnID: input.rootTurnID,
    turnID: input.turnID,
    responseID: input.responseID ?? null,
    kind: input.kind,
    sourceWrittenAt: input.sourceWrittenAt,
    helperReceivedAt: receivedAt.toISOString(),
    timeBasis: "sourceWrite",
    configuredModel:
      input.kind === "turnConfiguration"
        ? (input.configuredModel ?? null)
        : null,
    configuredEffort:
      input.kind === "turnConfiguration"
        ? (input.configuredEffort ?? null)
        : null,
    usage: input.kind === "responseUsage" ? input.usage : null,
    counterMode: input.kind === "responseUsage" ? "responseIncrement" : "none",
    coverage: "partial",
  };
  value.observationID = telemetryIdentity(value);
  return validateTelemetry(value);
}
