import assert from "node:assert/strict";
import test from "node:test";
import { Cause, Effect, Exit, Layer } from "effect";
import {
  HarnessConnection,
  logWorkProgram,
  NativeRejected,
} from "./harness-domain.ts";
import { createHarnessExecution } from "./harness-execution.ts";
import { nativeHarnessLayer } from "./harness-native.ts";

test("already cancelled dispatch and closed execution never start new work", async () => {
  const execution = createHarnessExecution();
  let started = 0;
  const program = Effect.sync(() => {
    started++;
  });
  const cancelled = await execution.run(
    program,
    AbortSignal.abort("private reason"),
  );
  assert.ok(Exit.isFailure(cancelled));
  assert.equal(Cause.hasInterrupts(cancelled.cause), true);
  await execution.close();
  assert.ok(Exit.isFailure(await execution.run(program)));
  assert.equal(started, 0);
});

test("request interruption and shutdown await native critical bookkeeping", async () => {
  const entered = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let persisted = false;
  const services = Layer.merge(
    nativeHarnessLayer("/private/fixture", {
      connection: async () => ({ connectionID: "fixture", revoked: false }),
      discover: async () => {},
      logWork: async (_root, _input, { signal }) => {
        signal.addEventListener("abort", () => aborted.resolve(), {
          once: true,
        });
        entered.resolve();
        await aborted.promise;
        await finish.promise;
        persisted = true;
        signal.throwIfAborted();
      },
    }),
    Layer.succeed(HarnessConnection, { connectionID: "fixture" }),
  );
  const execution = createHarnessExecution();
  const cancellation = new AbortController();
  let settled = false;
  const pending = execution
    .run(
      logWorkProgram({
        id: "abcdefab-1234-0000-0000-abcdefabcdef",
        text: "private",
      }).pipe(Effect.provide(services)),
      cancellation.signal,
    )
    .then((exit) => {
      settled = true;
      return exit;
    });
  await entered.promise;
  cancellation.abort("private cancellation reason");
  await aborted.promise;
  let closed = false;
  const closing = execution.close().then(() => {
    closed = true;
  });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(closed, false);
  finish.resolve();
  const exit = await pending;
  await closing;
  assert.ok(Exit.isFailure(exit));
  assert.equal(Cause.hasInterrupts(exit.cause), true);
  assert.equal(persisted, true);
});

test("tracing emits only fixed span names, durations, status and allowlisted failure tags", async () => {
  const lines: string[] = [];
  const execution = createHarnessExecution((line) => lines.push(line));
  const privateValue = "private-note-key-path-and-reason";
  const programs = [
    Effect.succeed({ text: privateValue, key: privateValue }),
    Effect.fail(
      new NativeRejected({
        receipt: {
          status: "rejected",
          reason: privateValue,
          nativeReceivedAt: null,
        },
      }),
    ),
    Effect.fail({ _tag: privateValue, message: privateValue }),
    Effect.die(new Error(privateValue)),
    Effect.interrupt,
  ];
  for (const program of programs) {
    await execution.run(
      program.pipe(
        Effect.withSpan("mcp.log_work", {
          attributes: { text: privateValue, key: privateValue },
        }),
      ),
    );
  }
  await execution.run(Effect.void.pipe(Effect.withSpan(privateValue)));
  await execution.close();
  assert.equal(lines.length, 5);
  assert.equal(lines.join("").includes(privateValue), false);
  const records = lines.map((line) => JSON.parse(line));
  assert.deepEqual(
    records.map(({ status }) => status),
    ["success", "failure", "failure", "defect", "interrupted"],
  );
  assert.equal(records[1].errorTag, "NativeRejected");
  for (const record of records) {
    assert.equal(record.span, "mcp.log_work");
    assert.ok(Number.isFinite(record.durationMs) && record.durationMs >= 0);
    assert.ok(
      Object.keys(record).every((key) =>
        ["span", "durationMs", "status", "errorTag"].includes(key),
      ),
    );
  }
});

test("a failing trace sink cannot turn a completed operation into failure", async () => {
  const execution = createHarnessExecution(() => {
    throw new Error("sink unavailable");
  });
  const exit = await execution.run(
    Effect.succeed(42).pipe(Effect.withSpan("mcp.log_work")),
  );
  assert.ok(Exit.isSuccess(exit));
  assert.equal(exit.value, 42);
  await execution.close();
});
