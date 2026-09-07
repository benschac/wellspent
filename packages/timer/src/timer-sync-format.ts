import type { TimerSyncStatus } from "./timer-sync";

export type TimerSyncProblem =
  | "snapshot-timeout"
  | "connection-error"
  | "action-rejected"
  | "invalid-response";

const problemMessages: Record<TimerSyncProblem, string> = {
  "snapshot-timeout":
    "Connected to a socket, but no valid timer snapshot arrived.",
  "connection-error":
    "The timer API reported a sync error. Saved state is unavailable.",
  "action-rejected":
    "The API could not confirm this action. Local changes may not be saved.",
  "invalid-response": "The API returned an invalid sync response.",
};

interface TimerSyncMessageContext {
  configured: boolean;
  uncertain: boolean;
  problem: TimerSyncProblem | null;
  pendingCount: number;
  status: TimerSyncStatus;
}

export function formatTimerSyncMessage({
  configured,
  uncertain,
  problem,
  pendingCount,
  status,
}: TimerSyncMessageContext): string {
  if (!configured) return "Local timer only. No sync API is configured.";
  if (uncertain)
    return "Some local actions are not confirmed saved. They are not automatically retried.";
  if (problem) return problemMessages[problem];
  if (pendingCount > 0)
    return status === "offline"
      ? "Local changes waiting for connection. Keep this client open; the queue is not durable."
      : "Local changes pending server confirmation.";
  if (status === "offline")
    return "Showing the last known timer locally. Reconnecting automatically.";
  if (status === "connecting")
    return "Waiting for a saved timer snapshot from the API.";
  return "Server-confirmed timer state. Running time advances locally.";
}
