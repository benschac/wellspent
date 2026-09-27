import assert from "node:assert/strict";
import test from "node:test";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import {
  discoverProgram,
  HarnessConnection,
  logWorkProgram,
  resolveConnectionProgram,
} from "./harness-domain.ts";
import { nativeHarnessLayer } from "./harness-native.ts";

const input = {
  id: "abcdefab-1234-0000-0000-abcdefabcdef",
  text: "  keep these bytes\n",
};
const receipt = {
  status: "acknowledged",
  reason: "committed",
  nativeReceivedAt: "2026-09-26T12:00:00.000Z",
};
const root = "/fixture/private-root";
const connectionID = "fixture-connection";

test("native adapter forwards the root, exact input and immutable identity, projecting only public receipt fields", async () => {
  const calls: unknown[] = [];
  const native = nativeHarnessLayer(root, {
    connection: async (path) => {
      calls.push(["connection", path]);
      return { connectionID, revoked: false };
    },
    discover: async (path, expected) => {
      calls.push(["discover", path, expected]);
    },
    logWork: async (path, note, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      calls.push([
        "log",
        path,
        note,
        { expectedConnectionID: options.expectedConnectionID },
      ]);
      return { ...receipt, key: "private-key", text: input.text };
    },
  });
  const bound = await Effect.runPromise(
    resolveConnectionProgram().pipe(Effect.provide(native)),
  );
  const services = Layer.merge(
    native,
    Layer.succeed(HarnessConnection, { connectionID: bound }),
  );
  await Effect.runPromise(discoverProgram().pipe(Effect.provide(services)));
  assert.deepEqual(
    await Effect.runPromise(
      logWorkProgram(input).pipe(Effect.provide(services)),
    ),
    receipt,
  );
  assert.deepEqual(calls, [
    ["connection", root],
    ["discover", root, connectionID],
    ["log", root, input, { expectedConnectionID: connectionID }],
  ]);
});

test("native helper failures are classified without retaining private errors", async (t) => {
  const cases = [
    [new Error("connection_revoked"), "ConnectionRevoked"],
    [new Error("connection_changed"), "ConnectionChanged"],
    [new Error("invalid_connection"), "ConnectionUnavailable"],
    [new Error("helper_unavailable"), "ConnectionUnavailable"],
    [new Error("no_active_recording"), "RecordingInactive"],
    [new Error("identity_conflict"), "IdConflict"],
    [new Error("native_commit_unconfirmed"), "NativeTimeout"],
    [new Error("invalid_response"), "NativeRejected"],
    [new Error("storage_full"), "NativeStorageFailure"],
    [new Error("storage_busy"), "NativeStorageFailure"],
    [new Error("invalid_private_file"), "NativeStorageFailure"],
    [
      Object.assign(new Error("private path and secret"), { code: "ENOENT" }),
      "ConnectionUnavailable",
    ],
    [
      Object.assign(new Error("private path and secret"), { code: "EACCES" }),
      "NativeStorageFailure",
    ],
    [
      Object.assign(new Error("private path and secret"), { code: "ENOSPC" }),
      "NativeStorageFailure",
    ],
  ] as const;
  for (const [cause, tag] of cases) {
    await t.test(
      `${tag}: ${cause.message === "private path and secret" ? "filesystem" : cause.message}`,
      async () => {
        const fail = async () => {
          throw cause;
        };
        const native = nativeHarnessLayer(root, {
          connection: fail,
          discover: fail,
          logWork: fail,
        });
        const services = Layer.merge(
          native,
          Layer.succeed(HarnessConnection, { connectionID }),
        );
        for (const program of [
          resolveConnectionProgram(),
          discoverProgram(),
          logWorkProgram(input),
        ]) {
          const exit = await Effect.runPromiseExit(
            program.pipe(Effect.provide(services)),
          );
          assert.ok(Exit.isFailure(exit));
          const failure = Cause.findErrorOption(exit.cause);
          assert.ok(Option.isSome(failure));
          assert.equal(failure.value._tag, tag);
          assert.equal(failure.value.receipt, undefined);
          assert.equal(
            JSON.stringify(failure.value).includes("private path and secret"),
            false,
          );
        }
      },
    );
  }
});

test("unrecognized native exceptions remain defects, not expected rejections", async () => {
  const fail = async () => {
    throw new Error("private unexpected details");
  };
  const native = nativeHarnessLayer(root, {
    connection: fail,
    discover: fail,
    logWork: fail,
  });
  const exit = await Effect.runPromiseExit(
    resolveConnectionProgram().pipe(Effect.provide(native)),
  );
  assert.ok(Exit.isFailure(exit));
  assert.equal(Cause.hasDies(exit.cause), true);
  assert.equal(Option.isNone(Cause.findErrorOption(exit.cause)), true);
});

test("malformed persisted receipts cannot become successful writes", async () => {
  const native = nativeHarnessLayer(root, {
    connection: async () => ({ connectionID, revoked: false }),
    discover: async () => {},
    logWork: async () => ({
      ...receipt,
      nativeReceivedAt: 123,
      key: "private",
    }),
  });
  const exit = await Effect.runPromiseExit(
    logWorkProgram(input).pipe(
      Effect.provide(
        Layer.merge(native, Layer.succeed(HarnessConnection, { connectionID })),
      ),
    ),
  );
  assert.ok(Exit.isFailure(exit));
  const failure = Cause.findErrorOption(exit.cause);
  assert.ok(Option.isSome(failure));
  assert.equal(failure.value._tag, "NativeStorageFailure");
  assert.equal(failure.value.receipt, undefined);
});
