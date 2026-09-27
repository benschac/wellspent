import assert from "node:assert/strict";
import test from "node:test";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import {
  ConnectionChanged,
  ConnectionUnavailable,
  discoverProgram,
  HarnessClient,
  HarnessConnection,
  type HarnessFailure,
  LogWorkInput,
  logWorkProgram,
  type NativeReceipt,
  resolveConnectionProgram,
} from "./harness-domain.ts";
import { uuid } from "./local-contract.mjs";

const input = {
  id: "ABCDEFAB-1234-0000-0000-ABCDEFABCDEF",
  text: "  exact note 😀\n",
};
const acknowledged: NativeReceipt = {
  status: "acknowledged",
  reason: "committed",
  nativeReceivedAt: "2026-09-26T12:00:00.000Z",
};
const unexpected = Effect.die(new Error("Unexpected native call"));
function services(overrides: Partial<HarnessClient["Service"]>) {
  return Layer.merge(
    Layer.succeed(HarnessClient, {
      resolveConnection: unexpected,
      discover: () => unexpected,
      logWork: () => unexpected,
      ...overrides,
    }),
    Layer.succeed(HarnessConnection, { connectionID: "bound-connection" }),
  );
}

function failureOf<A>(exit: Exit.Exit<A, HarnessFailure>) {
  assert.ok(Exit.isFailure(exit));
  const failure = Cause.findErrorOption(exit.cause);
  assert.ok(Option.isSome(failure));
  return failure.value;
}

test("Effect input schema preserves exact UUID/text and the advertised constraints", () => {
  const standard = Schema.toStandardJSONSchemaV1(
    Schema.toStandardSchemaV1(LogWorkInput, {
      parseOptions: { onExcessProperty: "error" },
    }),
  );
  assert.deepEqual(standard["~standard"].validate(input), { value: input });
  assert.deepEqual(
    standard["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
    {
      type: "object",
      properties: {
        id: {
          type: "string",
          pattern: uuid.source,
          format: "uuid",
          description: "Stable UUID identity, required for safe retries.",
        },
        text: {
          type: "string",
          minLength: 1,
          maxLength: 4096,
          description: "Explicit report, at most 4096 UTF-8 bytes.",
        },
      },
      required: ["id", "text"],
      additionalProperties: false,
    },
  );
});

test("connection resolution rejects revocation and retains unavailable failures", async () => {
  const revoked = await Effect.runPromiseExit(
    resolveConnectionProgram().pipe(
      Effect.provide(
        services({
          resolveConnection: Effect.succeed({
            connectionID: "revoked",
            revoked: true,
          }),
        }),
      ),
    ),
  );
  assert.equal(failureOf(revoked)._tag, "ConnectionRevoked");
  const missing = await Effect.runPromiseExit(
    resolveConnectionProgram().pipe(
      Effect.provide(
        services({
          resolveConnection: Effect.fail(new ConnectionUnavailable({})),
        }),
      ),
    ),
  );
  assert.equal(failureOf(missing)._tag, "ConnectionUnavailable");
});

test("discovery and logging use the injected identity and never resolve a new one", async () => {
  const calls: unknown[] = [];
  const layer = services({
    discover: (id) =>
      Effect.sync(() => {
        calls.push(["discover", id]);
      }),
    logWork: (note, id) =>
      Effect.sync(() => {
        calls.push(["log", note, id]);
        return acknowledged;
      }),
  });
  for (let i = 0; i < 2; i++) {
    await Effect.runPromise(discoverProgram().pipe(Effect.provide(layer)));
    assert.deepEqual(
      await Effect.runPromise(
        logWorkProgram(input).pipe(Effect.provide(layer)),
      ),
      acknowledged,
    );
  }
  assert.deepEqual(calls, [
    ["discover", "bound-connection"],
    ["log", input, "bound-connection"],
    ["discover", "bound-connection"],
    ["log", input, "bound-connection"],
  ]);
});

test("terminal native outcomes have specific failure tags and retain their receipt", async (t) => {
  for (const [reason, tag] of [
    ["connection_revoked", "ConnectionRevoked"],
    ["connection_changed", "ConnectionChanged"],
    ["helper_unavailable", "ConnectionUnavailable"],
    ["no_active_recording", "RecordingInactive"],
    ["identity_conflict", "IdConflict"],
    ["outside_interval", "NativeRejected"],
    ["future_native_reason", "NativeRejected"],
    ["native_commit_unconfirmed", "NativeTimeout"],
  ] as const) {
    await t.test(reason, async () => {
      const receipt: NativeReceipt = {
        status:
          reason === "native_commit_unconfirmed" ? "unconfirmed" : "rejected",
        reason,
        nativeReceivedAt: null,
      };
      const exit = await Effect.runPromiseExit(
        logWorkProgram(input).pipe(
          Effect.provide(
            services({
              logWork: () => Effect.succeed(receipt),
            }),
          ),
        ),
      );
      const failure = failureOf(exit);
      assert.equal(failure._tag, tag);
      assert.deepEqual(failure.receipt, receipt);
    });
  }
});

test("discovery propagates changed identity without converting it to success", async () => {
  const exit = await Effect.runPromiseExit(
    discoverProgram().pipe(
      Effect.provide(
        services({
          discover: () => Effect.fail(new ConnectionChanged({})),
        }),
      ),
    ),
  );
  assert.equal(failureOf(exit)._tag, "ConnectionChanged");
});
