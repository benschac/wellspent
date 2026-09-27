import { Context, Effect, Schema } from "effect";
import { uuid } from "./local-contract.mjs";

export const LogWorkInput = Schema.Struct({
  id: Schema.String.check(
    Schema.makeFilter((id) => uuid.test(id), {
      message: "A stable UUID is required.",
      toJsonSchema: () => ({ pattern: uuid.source, format: "uuid" }),
    }),
  ).annotate({
    description: "Stable UUID identity, required for safe retries.",
  }),
  text: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(4096),
    Schema.makeFilter((text) => text.trim().length > 0, {
      message: "An explicit non-empty note is required.",
      toJsonSchema: () => ({}),
    }),
    Schema.makeFilter((text) => Buffer.byteLength(text, "utf8") <= 4096, {
      message: "At most 4096 UTF-8 bytes.",
      toJsonSchema: () => ({}),
    }),
    Schema.makeFilter((text) => text.isWellFormed(), {
      message: "Text must be well-formed Unicode.",
      toJsonSchema: () => ({}),
    }),
  ).annotate({ description: "Explicit report, at most 4096 UTF-8 bytes." }),
});
export type LogWorkInput = typeof LogWorkInput.Type;

export const NativeReceipt = Schema.Struct({
  status: Schema.Literals(["acknowledged", "rejected", "unconfirmed"]),
  reason: Schema.String,
  nativeReceivedAt: Schema.NullOr(Schema.String),
});
export type NativeReceipt = typeof NativeReceipt.Type;

// Only public receipt data crosses this boundary; raw native errors stay out of
// typed failures, MCP responses and diagnostics.
const failureFields = { receipt: Schema.optional(NativeReceipt) };
export class ConnectionUnavailable extends Schema.TaggedError<ConnectionUnavailable>()(
  "ConnectionUnavailable",
  failureFields,
) {}
export class ConnectionRevoked extends Schema.TaggedError<ConnectionRevoked>()(
  "ConnectionRevoked",
  failureFields,
) {}
export class ConnectionChanged extends Schema.TaggedError<ConnectionChanged>()(
  "ConnectionChanged",
  failureFields,
) {}
export class RecordingInactive extends Schema.TaggedError<RecordingInactive>()(
  "RecordingInactive",
  failureFields,
) {}
export class IdConflict extends Schema.TaggedError<IdConflict>()(
  "IdConflict",
  failureFields,
) {}
export class NativeTimeout extends Schema.TaggedError<NativeTimeout>()(
  "NativeTimeout",
  failureFields,
) {}
export class NativeRejected extends Schema.TaggedError<NativeRejected>()(
  "NativeRejected",
  failureFields,
) {}
export class NativeStorageFailure extends Schema.TaggedError<NativeStorageFailure>()(
  "NativeStorageFailure",
  failureFields,
) {}

export type HarnessFailure =
  | ConnectionUnavailable
  | ConnectionRevoked
  | ConnectionChanged
  | RecordingInactive
  | IdConflict
  | NativeTimeout
  | NativeRejected
  | NativeStorageFailure;

export class HarnessClient extends Context.Service<
  HarnessClient,
  {
    readonly resolveConnection: Effect.Effect<
      { readonly connectionID: string; readonly revoked: boolean },
      HarnessFailure
    >;
    readonly discover: (
      connectionID: string,
    ) => Effect.Effect<void, HarnessFailure>;
    readonly logWork: (
      input: LogWorkInput,
      connectionID: string,
    ) => Effect.Effect<NativeReceipt, HarnessFailure>;
  }
>()("@repo/codex-capture/HarnessClient") {}

export class HarnessConnection extends Context.Service<
  HarnessConnection,
  {
    readonly connectionID: string;
  }
>()("@repo/codex-capture/HarnessConnection") {}

export const resolveConnectionProgram = Effect.fn("harness.resolveConnection")(
  function* () {
    const client = yield* HarnessClient;
    const current = yield* client.resolveConnection;
    if (current.revoked) return yield* new ConnectionRevoked({});
    return current.connectionID;
  },
);

export const discoverProgram = Effect.fn("harness.discover")(function* () {
  const client = yield* HarnessClient;
  const { connectionID } = yield* HarnessConnection;
  yield* client.discover(connectionID);
});

export const logWorkProgram = Effect.fn("harness.log_work")(function* (
  input: LogWorkInput,
) {
  const client = yield* HarnessClient;
  const { connectionID } = yield* HarnessConnection;
  const receipt = yield* client.logWork(input, connectionID);
  if (receipt.status === "acknowledged") return receipt;
  if (receipt.status === "unconfirmed")
    return yield* new NativeTimeout({ receipt });
  switch (receipt.reason) {
    case "connection_revoked":
      return yield* new ConnectionRevoked({ receipt });
    case "connection_changed":
      return yield* new ConnectionChanged({ receipt });
    case "helper_unavailable":
      return yield* new ConnectionUnavailable({ receipt });
    case "no_active_recording":
      return yield* new RecordingInactive({ receipt });
    case "identity_conflict":
      return yield* new IdConflict({ receipt });
    default:
      return yield* new NativeRejected({ receipt });
  }
});
