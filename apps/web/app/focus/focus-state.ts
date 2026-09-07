export {
  commandsSchema,
  elapsedAt,
  type FocusCommand,
  type FocusSession,
  projectCommand,
  type SessionDetail as FocusDetail,
} from "@repo/session-domain";

export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
