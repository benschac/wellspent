import { Effect, Layer, Option, Schema } from "effect";
import {
  ConnectionChanged,
  ConnectionRevoked,
  ConnectionUnavailable,
  HarnessClient,
  type HarnessFailure,
  IdConflict,
  type LogWorkInput,
  NativeReceipt,
  NativeRejected,
  NativeStorageFailure,
  NativeTimeout,
  RecordingInactive,
} from "./harness-domain.ts";
import { connection, discover, logWork } from "./harness-helper.ts";

const errorCode = Schema.decodeUnknownOption(
  Schema.Struct({ code: Schema.String }),
);

// Match the helpers' actual reasons, never substring-match private messages.
function knownFailure(cause: unknown): HarnessFailure | undefined {
  if (!(cause instanceof Error)) return undefined;
  switch (cause.message) {
    case "connection_revoked":
      return new ConnectionRevoked({});
    case "connection_changed":
      return new ConnectionChanged({});
    case "invalid_connection":
    case "helper_unavailable":
      return new ConnectionUnavailable({});
    case "no_active_recording":
      return new RecordingInactive({});
    case "identity_conflict":
      return new IdConflict({});
    case "native_commit_unconfirmed":
      return new NativeTimeout({});
    case "invalid_note":
    case "invalid_response":
      return new NativeRejected({});
    case "storage_full":
    case "storage_busy":
    case "invalid_lock":
    case "invalid_private_directory":
    case "invalid_private_file":
      return new NativeStorageFailure({});
  }
  const code = errorCode(cause);
  if (Option.isSome(code)) {
    switch (code.value.code) {
      case "ENOENT":
        return new ConnectionUnavailable({});
      case "EACCES":
      case "EPERM":
      case "ENOSPC":
      case "EDQUOT":
      case "EIO":
      case "EROFS":
        return new NativeStorageFailure({});
    }
  }
  return undefined;
}

const nativeOperation = Effect.fn("harness.native")(function* <A>(
  operation: (signal: AbortSignal) => Promise<A>,
) {
  return yield* Effect.callback<A, unknown>((resume, signal) => {
    const settled = Promise.resolve()
      .then(() => operation(signal))
      .then(
        (value) => resume(Effect.succeed(value)),
        (cause) => resume(Effect.fail(cause)),
      );
    // Effect aborts signal before running this finalizer. Wait for the native
    // helper's short persistence sections before reporting interruption done.
    return Effect.promise(() => settled);
  }).pipe(
    Effect.catch((cause) => {
      const failure = knownFailure(cause);
      return failure ? Effect.fail(failure) : Effect.die(cause);
    }),
  );
});

const decodeReceipt = Schema.decodeUnknownEffect(NativeReceipt);

type NativeOperations = {
  readonly connection: (
    root: string,
  ) => Promise<{ connectionID: string; revoked: boolean }>;
  readonly discover: (root: string, connectionID: string) => Promise<void>;
  readonly logWork: (
    root: string,
    input: LogWorkInput,
    options: { expectedConnectionID: string; signal: AbortSignal },
  ) => Promise<unknown>;
};

export function nativeHarnessLayer(
  root: string,
  native: NativeOperations = { connection, discover, logWork },
) {
  return Layer.succeed(HarnessClient, {
    resolveConnection: nativeOperation(() => native.connection(root)),
    discover: (connectionID) =>
      nativeOperation(() => native.discover(root, connectionID)),
    logWork: (input, expectedConnectionID) =>
      nativeOperation((signal) =>
        native.logWork(root, input, { expectedConnectionID, signal }),
      ).pipe(
        Effect.flatMap(decodeReceipt),
        Effect.catchTag("SchemaError", () =>
          Effect.fail(new NativeStorageFailure({})),
        ),
      ),
  });
}
