import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeTelemetryFixture,
  summarizeTelemetryFixtures,
} from "./telemetry-feasibility.mjs";

// Synthetic shape pinned to rust-v0.157.1 protocol.rs TokenUsageRecord.
// No fixture comes from private Codex history or an authenticated provider call.
function response(id = "response-1", input = 100, output = 20) {
  const snapshot = (total) => ({
    input_tokens: total - 20,
    cached_input_tokens: 10,
    cache_write_input_tokens: 0,
    output_tokens: 20,
    reasoning_output_tokens: 5,
    total_tokens: total,
  });
  return {
    type: "token_usage_record",
    timestamp: "2026-09-26T12:00:00.000Z",
    payload: {
      thread_id: "00000000-0000-0000-0000-000000000001",
      turn_id: "turn-1",
      session_id: "00000000-0000-0000-0000-000000000001",
      root_turn_id: "turn-1",
      response_id: id,
      usage: {
        input_tokens: input,
        cached_input_tokens: 10,
        cache_write_input_tokens: 0,
        output_tokens: output,
        reasoning_output_tokens: 5,
        total_tokens: input + output,
      },
      turn_token_usage: snapshot(1000),
      thread_token_usage: snapshot(5000),
    },
  };
}

test("response atoms count once across duplicate, copy, resume and reordered delivery", () => {
  const first = response();
  const second = response("response-2", 50, 10);
  const copied = structuredClone(first);
  copied.timestamp = "2026-09-27T12:00:00.000Z";
  copied.payload.thread_token_usage.total_tokens = 9000;
  const expected = summarizeTelemetryFixtures([first, second]);
  assert.equal(expected.observedTotalTokens, 180);
  assert.deepEqual(
    summarizeTelemetryFixtures([second, copied, first, second]),
    expected,
  );
  assert.equal(expected.coverage, "partial");
  assert.equal(expected.unallocated, true);
});

test("conflicting same identity is visible and excluded regardless of order", () => {
  const first = response();
  const conflict = response("response-1", 110, 20);
  const good = response("response-2", 50, 10);
  const actual = summarizeTelemetryFixtures([first, good, conflict, first]);
  assert.equal(actual.observedTotalTokens, 60);
  assert.equal(actual.conflicts, 1);
  assert.deepEqual(summarizeTelemetryFixtures([conflict, first, good]), actual);
  conflict.payload.usage = first.payload.usage;
  conflict.payload.turn_id = "different-turn";
  assert.equal(summarizeTelemetryFixtures([first, conflict]).conflicts, 1);
});

test("cumulative repeats, reset and estimated last counts never become increments", () => {
  const snapshots = [1000, 1000, 1200, 80].map((total) => ({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: { total_tokens: 5000 },
      },
    },
  }));
  assert.equal(summarizeTelemetryFixtures(snapshots).observedTotalTokens, null);
  const observed = summarizeTelemetryFixtures([...snapshots, response()]);
  assert.equal(observed.observedTotalTokens, 120);
  assert.deepEqual(observed.issues, ["non-accounting-record"]);
});

test("parallel threads are distinct; root/session linkage does not duplicate copied ancestors", () => {
  const parent = response();
  const child = response("child-response", 50, 10);
  child.payload.thread_id = "00000000-0000-0000-0000-000000000002";
  const result = summarizeTelemetryFixtures([
    parent,
    child,
    structuredClone(parent),
  ]);
  assert.equal(result.observedTotalTokens, 180);
  assert.equal(result.observedResponses, 2);
});

test("model switches, compaction and selected task cannot establish response model or effort", () => {
  const configured = {
    type: "turn_context",
    payload: { turn_id: "turn-1", model: "M2", effort: "high" },
  };
  const first = response(); // May be pre-turn M1 compaction under the new turn ID.
  first.payload.model = "M2";
  first.payload.effort = "high";
  first.payload.taskID = "task-B";
  const atom = normalizeTelemetryFixture(first);
  assert.equal(atom.executedModel, null);
  assert.equal(atom.executedEffort, null);
  assert.equal(atom.taskID, null);
  assert.equal(
    summarizeTelemetryFixtures([
      configured,
      first,
      response("response-2", 50, 10),
    ]).observedTotalTokens,
    180,
  );
});

test("missing usage is unknown, valid zero is observed, and missing optional subset stays unknown", () => {
  const missing = response();
  delete missing.payload.usage;
  assert.equal(normalizeTelemetryFixture(missing).status, "usage-unavailable");
  assert.equal(summarizeTelemetryFixtures([missing]).observedTotalTokens, null);
  const zero = response("zero", 0, 0);
  zero.payload.usage.cached_input_tokens = 0;
  zero.payload.usage.reasoning_output_tokens = 0;
  delete zero.payload.usage.cache_write_input_tokens;
  assert.equal(
    normalizeTelemetryFixture(zero).usage.cache_write_input_tokens,
    null,
  );
  assert.equal(summarizeTelemetryFixtures([zero]).observedTotalTokens, 0);
});

test("invalid counters, inconsistent subsets and totals fail without invented repair", () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "120"]) {
    const invalid = response();
    invalid.payload.usage.total_tokens = value;
    assert.equal(normalizeTelemetryFixture(invalid).status, "invalid-usage");
  }
  for (const key of [
    "cached_input_tokens",
    "reasoning_output_tokens",
    "cache_write_input_tokens",
    "total_tokens",
  ]) {
    const invalid = response();
    invalid.payload.usage[key] = 999;
    assert.equal(
      normalizeTelemetryFixture(invalid).status,
      "inconsistent-usage",
    );
  }
});

test("summation overflow is unknown rather than an imprecise number", () => {
  const large = response("large", Number.MAX_SAFE_INTEGER - 20, 20);
  const actual = summarizeTelemetryFixtures([large, response()]);
  assert.equal(actual.observedTotalTokens, null);
  assert.deepEqual(actual.issues, ["total-overflow"]);
});

test("strict version/identity gates and allowlist keep private canaries out", () => {
  const record = response();
  const original = JSON.stringify(record);
  record.privatePrompt = "PRIVATE_CANARY";
  record.payload.cwd = "PRIVATE_CANARY";
  record.payload.usage.privateReasoning = "PRIVATE_CANARY";
  const output = normalizeTelemetryFixture(record);
  assert.equal(JSON.stringify(output).includes("PRIVATE_CANARY"), false);
  assert.equal(
    normalizeTelemetryFixture(record, "unknown").status,
    "unsupported-version",
  );
  assert.equal(normalizeTelemetryFixture(null).status, "invalid-record");
  record.payload.response_id = "bad/PRIVATE_CANARY";
  assert.deepEqual(normalizeTelemetryFixture(record), {
    status: "invalid-identity",
  });
  const untouched = JSON.parse(original);
  normalizeTelemetryFixture(untouched);
  assert.equal(JSON.stringify(untouched), original);
});
