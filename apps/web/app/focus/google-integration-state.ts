import type { FocusCommand, FocusSession } from "./focus-state";

/** A projected finish is not exportable until every command for it is saved. */
export function googleEligibleSessionIds(
  sessions: FocusSession[],
  pending: FocusCommand[],
): Set<string> {
  const pendingIds = new Set(
    pending.map((command) =>
      command.type === "create" ? command.input.id : command.input.sessionId,
    ),
  );
  return new Set(
    sessions
      .filter(
        (session) =>
          session.status === "completed" && !pendingIds.has(session.id),
      )
      .map((session) => session.id),
  );
}

export function googleCallbackMessage(search: string): string | null {
  const params = new URLSearchParams(search);
  const feature = params.get("google");
  if (feature !== "calendar" && feature !== "sheets") return null;
  const name = feature === "calendar" ? "Calendar" : "Sheets";
  if (params.get("result") === "error")
    return `Google ${name} connection did not finish. Try connecting again.`;
  if (params.get("result") === "connected")
    return `Returned from Google ${name}. Checking your connection…`;
  return null;
}
