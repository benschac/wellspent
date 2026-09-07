import {
  type RealtimeTimerState,
  realtimeTimerCommandAckEvent,
  realtimeTimerCommandAckSchema,
  realtimeTimerStateEvent,
  realtimeTimerStateSchema,
} from "@repo/api-contract";

export type TimerSyncMessage =
  | { type: "state"; state: RealtimeTimerState }
  | { type: "acknowledgement"; commandId: string; state: RealtimeTimerState }
  | { type: "rejection"; commandId: string | undefined }
  | { type: "invalid" }
  | { type: "ignored" };

/** Decode validated server data without changing sync state or exposing errors. */
export function decodeTimerSyncMessage(data: unknown): TimerSyncMessage {
  if (typeof data !== "string") return { type: "invalid" };
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return { type: "invalid" };
  }
  if (
    typeof message !== "object" ||
    message === null ||
    !("event" in message) ||
    typeof message.event !== "string"
  )
    return { type: "invalid" };

  const payload = "data" in message ? message.data : undefined;
  switch (message.event) {
    case realtimeTimerStateEvent: {
      const result = realtimeTimerStateSchema.safeParse(payload);
      return result.success
        ? { type: "state", state: result.data }
        : { type: "invalid" };
    }
    case realtimeTimerCommandAckEvent: {
      const result = realtimeTimerCommandAckSchema.safeParse(payload);
      return result.success
        ? { type: "acknowledgement", ...result.data }
        : { type: "invalid" };
    }
    case "exception":
      return {
        type: "rejection",
        commandId:
          typeof payload === "object" &&
          payload !== null &&
          "commandId" in payload &&
          typeof payload.commandId === "string"
            ? payload.commandId
            : undefined,
      };
    default:
      return { type: "ignored" };
  }
}
