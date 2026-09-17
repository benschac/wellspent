// Local-only Codex metadata. This module never invokes the legacy upload path.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eventFromHook } from "./timer-capture.mjs";

export const MAX_BODY = 8192;
export const MAX_WIRE = 16384;
export const opaque = /^[a-zA-Z0-9_-]{1,256}$/;
export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const rejectionReasons = new Set([
  "invalidPacket",
  "untrustedSender",
  "invalidAssociation",
  "expiredBinding",
  "outsideInterval",
  "interruptedInterval",
  "identityConflict",
]);
export function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function canonicalTime(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function base64(value, max = MAX_BODY) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("invalidPacket");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > max || bytes.toString("base64") !== value)
    throw new Error("invalidPacket");
  return bytes;
}
export function sign(body, key, domain = "event", maxBody = MAX_BODY) {
  const bytes = Buffer.from(JSON.stringify(body));
  if (bytes.length > maxBody) throw new Error("packetTooLarge");
  const packet = {
    body: bytes.toString("base64"),
    mac: createHmac("sha256", key)
      .update(`wellspent-c3a-${domain}\0`)
      .update(bytes)
      .digest("base64"),
  };
  if (Buffer.byteLength(JSON.stringify(packet)) > MAX_WIRE)
    throw new Error("packetTooLarge");
  return packet;
}
export function decode(packet, maxBody = MAX_BODY) {
  if (
    !exactKeys(packet, ["body", "mac"]) ||
    Buffer.byteLength(JSON.stringify(packet)) > MAX_WIRE
  )
    throw new Error("invalidPacket");
  const bytes = base64(packet.body, maxBody);
  const mac = base64(packet.mac, 32);
  if (mac.length !== 32) throw new Error("invalidPacket");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { bytes, mac, value: JSON.parse(text) };
}
export function verify(packet, key, domain, maxBody = MAX_BODY) {
  const decoded = decode(packet, maxBody);
  const expected = createHmac("sha256", key)
    .update(`wellspent-c3a-${domain}\0`)
    .update(decoded.bytes)
    .digest();
  if (!timingSafeEqual(decoded.mac, expected))
    throw new Error("untrustedSender");
  return decoded.value;
}
export function bodyDigest(packet) {
  return createHash("sha256").update(base64(packet.body)).digest("hex");
}
export function localIdentity(senderID, threadID, kind, invocationID) {
  const h = createHash("sha256")
    .update(
      ["wellspent-local-codex-v1", senderID, threadID, kind, invocationID].join(
        "\0",
      ),
    )
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function metadataFromHook(input, binding, now = new Date()) {
  const kind = input?.hook_event_name;
  const invocationID =
    kind === "PostToolUse" ? input.tool_use_id : input?.turn_id;
  if (!["PostToolUse", "Stop"].includes(kind))
    return { reason: "unsupported_hook" };
  if (
    ![input.session_id, input.turn_id, invocationID].every(
      (v) => typeof v === "string" && opaque.test(v),
    )
  )
    return { reason: "missing_identity" };
  if (!binding || input.session_id !== binding.threadID)
    return { reason: "unassociated" };
  const command =
    input.tool_input?.command ??
    input.tool_input?.cmd ??
    input.tool_input?.code;
  if (
    typeof command === "string" &&
    /(?:local-(?:helper|capture|contract)\.mjs|codex-local|wellspent-c3a-)/.test(
      command,
    )
  )
    return { reason: "self_capture" };
  const legacy = eventFromHook(
    input,
    {
      apiOrigin: "http://127.0.0.1",
      sessionId: binding.recordingID,
      shareAssistantSummary: false,
    },
    now,
  );
  if (!legacy) return { reason: "self_capture" };
  return {
    version: 1,
    eventID: localIdentity(
      binding.senderID,
      input.session_id,
      kind,
      invocationID,
    ),
    senderID: binding.senderID,
    bindingID: binding.bindingID,
    localScopeID: binding.localScopeID,
    recordingID: binding.recordingID,
    intervalID: binding.intervalID,
    threadID: input.session_id,
    turnID: input.turn_id,
    invocationID,
    kind,
    hookReceivedAt: now.toISOString(),
    occurredAt: null,
    timeBasis: "hookReceived",
    toolName:
      kind === "PostToolUse"
        ? typeof input.tool_name === "string" &&
          /^[a-zA-Z0-9_.:-]{1,160}$/.test(input.tool_name)
          ? input.tool_name
          : "tool"
        : null,
    reportedResult: legacy.summary.includes("(reported failure)")
      ? "failure"
      : legacy.summary.includes("(reported success)")
        ? "success"
        : "unknown",
  };
}
export function validateBundle(bundle) {
  if (
    !exactKeys(bundle, ["version", "endpoint", "key", "binding"]) ||
    bundle.version !== 1
  )
    throw new Error("invalid_pairing");
  if (
    typeof bundle.endpoint !== "string" ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(bundle.endpoint)
  )
    throw new Error("invalid_endpoint");
  const port = Number(new URL(bundle.endpoint).port);
  if (port < 1024 || port > 65535) throw new Error("invalid_endpoint");
  if (base64(bundle.key, 32).length !== 32) throw new Error("invalid_pairing");
  const b = bundle.binding;
  if (
    !exactKeys(b, [
      "bindingID",
      "senderID",
      "localScopeID",
      "recordingID",
      "intervalID",
      "threadID",
      "issuedAt",
      "acceptUntil",
    ]) ||
    ![b.bindingID, b.recordingID, b.intervalID].every(
      (v) => typeof v === "string" && uuid.test(v),
    ) ||
    ![b.senderID, b.threadID].every(
      (v) => typeof v === "string" && opaque.test(v),
    ) ||
    typeof b.localScopeID !== "string" ||
    b.localScopeID.length < 1 ||
    Buffer.byteLength(b.localScopeID) > 200 ||
    [...b.localScopeID].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !canonicalTime(b.issuedAt) ||
    !canonicalTime(b.acceptUntil) ||
    Date.parse(b.acceptUntil) - Date.parse(b.issuedAt) !== 7 * 86400000
  )
    throw new Error("invalid_pairing");
  return {
    ...bundle,
    binding: {
      ...b,
      bindingID: b.bindingID.toLowerCase(),
      recordingID: b.recordingID.toLowerCase(),
      intervalID: b.intervalID.toLowerCase(),
    },
  };
}
