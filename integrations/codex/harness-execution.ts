import { Cause, Effect, Exit, Logger, Option, Schema, Tracer } from "effect";

const spans = new Set([
  "mcp.log_work",
  "harness.log_work",
  "harness.discover",
  "harness.resolveConnection",
  "harness.native",
]);
const errorTag = Schema.decodeUnknownOption(
  Schema.Struct({
    _tag: Schema.Literals([
      "ConnectionUnavailable",
      "ConnectionRevoked",
      "ConnectionChanged",
      "RecordingInactive",
      "IdConflict",
      "NativeTimeout",
      "NativeRejected",
      "NativeStorageFailure",
    ]),
  }),
);

// Only this projection reaches diagnostics. Never export a span, cause, receipt,
// annotation, input, cancellation reason, identifier or filesystem path.
function outcome(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) return { status: "success" };
  if (Cause.hasInterrupts(exit.cause)) return { status: "interrupted" };
  if (Cause.hasDies(exit.cause)) return { status: "defect" };
  const tag = Option.flatMap(Cause.findErrorOption(exit.cause), errorTag);
  return {
    status: "failure",
    ...(Option.isSome(tag) ? { errorTag: tag.value._tag } : {}),
  };
}

export function createHarnessExecution(writeTrace?: (line: string) => void) {
  const shutdown = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const quiet = Logger.layer([]);
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        if (!writeTrace || !spans.has(options.name)) return;
        try {
          writeTrace(
            `${JSON.stringify({
              span: options.name,
              durationMs: Number(endTime - options.startTime) / 1e6,
              ...outcome(exit),
            })}\n`,
          );
        } catch {
          // A failed diagnostic sink must not change a durable write's outcome.
        }
      };
      return span;
    },
  });
  return {
    run<A, E>(program: Effect.Effect<A, E>, signal?: AbortSignal) {
      // runPromiseExit starts synchronously before checking its signal. Reject
      // already-cancelled dispatches before any native operation can begin.
      if (shutdown.signal.aborted || signal?.aborted)
        return Promise.resolve<Exit.Exit<A, E>>(Exit.interrupt());
      const promise = Effect.runPromiseExit(
        program.pipe(Effect.provide(quiet), Effect.withTracer(tracer)),
        {
          signal: AbortSignal.any([
            shutdown.signal,
            ...(signal ? [signal] : []),
          ]),
        },
      );
      pending.add(promise);
      void promise.then(() => pending.delete(promise));
      return promise;
    },
    async close() {
      shutdown.abort();
      // Native adapter finalizers wait for critical filesystem bookkeeping.
      await Promise.all(pending);
    },
  };
}

export type HarnessExecution = ReturnType<typeof createHarnessExecution>;
