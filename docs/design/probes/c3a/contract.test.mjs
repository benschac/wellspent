import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localIdentity, metadataFromHook, sign } from "./contract.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixture.json", import.meta.url)),
);
const binding = fixture.binding;
const input = {
  hook_event_name: "PostToolUse",
  session_id: binding.threadID,
  turn_id: "turn_fixture",
  tool_use_id: "tool_fixture",
  tool_name: "Bash",
  tool_response: { exit_code: 0 },
};
const time = new Date("2027-01-15T08:00:05.000Z");
test("Node metadata and HMAC match the fixture consumed by Swift", () => {
  const body = metadataFromHook(input, binding, time);
  assert.deepEqual(
    sign(body, Buffer.from(fixture.key, "base64")),
    fixture.packet,
  );
});
test("privacy allowlist never captures prose, cwd, transcript, input/output, or invented occurrence", () => {
  const body = metadataFromHook(
    {
      ...input,
      cwd: "/private/example",
      transcript_path: "/never/open",
      last_assistant_message: "PRIVATE PROSE",
      timestamp: "2027-01-15T08:00:01.000Z",
      tool_input: { command: "echo PRIVATE INPUT" },
      tool_response: { exit_code: 0, output: "PRIVATE OUTPUT" },
    },
    binding,
    time,
  );
  assert.equal(body.occurredAt, null);
  assert.equal(body.timeBasis, "hookReceived");
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|\/private|\/never/);
});
test("stable local identity is independent of receipt time and association, and separated by invocation/kind/sender", () => {
  const first = metadataFromHook(input, binding, time);
  const retry = metadataFromHook(
    input,
    { ...binding, intervalID: "different" },
    new Date(time.getTime() + 1000),
  );
  assert.equal(first.eventID, retry.eventID);
  assert.notEqual(first.hookReceivedAt, retry.hookReceivedAt); // Producer must spool once and retry saved bytes.
  for (const args of [
    ["other", binding.threadID, "PostToolUse", "tool_fixture"],
    [binding.senderID, binding.threadID, "Stop", "tool_fixture"],
    [binding.senderID, binding.threadID, "PostToolUse", "other"],
  ])
    assert.notEqual(first.eventID, localIdentity(...args));
});
test("missing IDs or association fail closed; self-capture remains excluded", () => {
  assert.equal(
    metadataFromHook({ ...input, tool_use_id: undefined }, binding, time)
      .reason,
    "missing_identity",
  );
  assert.equal(metadataFromHook(input, null, time).reason, "unassociated");
  assert.equal(
    metadataFromHook({ ...input, session_id: "other" }, binding, time).reason,
    "unassociated",
  );
  assert.equal(
    metadataFromHook(
      {
        ...input,
        tool_input: { command: "node integrations/codex/timer-capture.mjs" },
      },
      binding,
      time,
    ).reason,
    "self_capture",
  );
});
test("Stop retains turn identity and no assistant prose; reported failure is not verified completion", () => {
  const stop = metadataFromHook(
    { ...input, hook_event_name: "Stop", last_assistant_message: "PRIVATE" },
    binding,
    time,
  );
  assert.equal(stop.invocationID, "turn_fixture");
  assert.equal(stop.toolName, null);
  assert.equal(stop.reportedResult, "unknown");
  assert.equal(
    metadataFromHook(
      { ...input, tool_response: { exit_code: 1 } },
      binding,
      time,
    ).reportedResult,
    "failure",
  );
});
