// C3a executable specification only. No CLI, hook installation, filesystem, or network access.
import { createHash, createHmac } from "node:crypto";
import { eventFromHook } from "../../../../integrations/codex/timer-capture.mjs";

const opaque = /^[a-zA-Z0-9_-]{1,256}$/;
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

export function metadataFromHook(input, binding, hookReceivedAt) {
  const kind = input?.hook_event_name;
  const invocationID =
    kind === "PostToolUse" ? input.tool_use_id : input?.turn_id;
  if (!["PostToolUse", "Stop"].includes(kind))
    return { reason: "unsupported_hook" };
  if (
    ![input.session_id, input.turn_id, invocationID].every(
      (value) => typeof value === "string" && opaque.test(value),
    )
  )
    return { reason: "missing_identity" };
  if (!binding || input.session_id !== binding.threadID)
    return { reason: "unassociated" };
  // Reuse current self-capture suppression. Never opt in to assistant prose or call enqueue/flush.
  const legacy = eventFromHook(
    input,
    {
      apiOrigin: "http://127.0.0.1",
      sessionId: binding.recordingID,
      shareAssistantSummary: false,
    },
    hookReceivedAt,
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
    hookReceivedAt: hookReceivedAt.toISOString(),
    // The selected hooks do not guarantee an occurrence timestamp. Never copy an arbitrary input timestamp.
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

// MAC the exact UTF-8 bytes. No cross-language JSON canonicalization assumption.
export function sign(body, key, domain = "event") {
  const bytes = Buffer.from(JSON.stringify(body));
  return {
    body: bytes.toString("base64"),
    mac: createHmac("sha256", key)
      .update(`wellspent-c3a-${domain}\0`)
      .update(bytes)
      .digest("base64"),
  };
}
