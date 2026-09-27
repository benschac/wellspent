import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Exit } from "effect";
import {
  IdConflict,
  type NativeReceipt,
  NativeRejected,
  NativeTimeout,
} from "./harness-domain.ts";
import { logWorkToolResult } from "./harness-tool-result.ts";

const id = "ABCDEFAB-1234-0000-0000-ABCDEFABCDEF";
const retry =
  "Not confirmed. Local connection unavailable, revoked, or this id conflicts with an earlier note. Preserve the original id and text; inspect AI Harness in Wellspent.";

test("acknowledged, rejected and uncertain results retain exact MCP response content", () => {
  for (const status of ["acknowledged", "rejected", "unconfirmed"] as const) {
    const receipt: NativeReceipt = {
      status,
      reason:
        status === "acknowledged"
          ? "committed"
          : status === "rejected"
            ? "outside_interval"
            : "native_commit_unconfirmed",
      nativeReceivedAt:
        status === "acknowledged" ? "2026-09-26T12:00:00.000Z" : null,
    };
    const exit =
      status === "acknowledged"
        ? Exit.succeed(receipt)
        : Exit.fail(
            status === "rejected"
              ? new NativeRejected({ receipt })
              : new NativeTimeout({ receipt }),
          );
    assert.deepEqual(logWorkToolResult(id, exit), {
      isError: status !== "acknowledged",
      content: [
        {
          type: "text",
          text: JSON.stringify({ id: id.toLowerCase(), ...receipt }),
        },
        ...(status === "acknowledged" ? [] : [{ type: "text", text: retry }]),
      ],
    });
  }
});

test("failures without receipts, defects and interruption expose only the conservative message", async () => {
  const interrupted = await Effect.runPromiseExit(Effect.interrupt);
  for (const exit of [
    Exit.fail(new IdConflict({})),
    Exit.die(new Error("private note and secret")),
    interrupted,
  ]) {
    assert.deepEqual(logWorkToolResult(id, exit), {
      isError: true,
      content: [{ type: "text", text: retry }],
    });
  }
});
