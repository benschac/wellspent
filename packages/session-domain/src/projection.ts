import { parseISO } from "date-fns";
import type { FocusCommand, FocusSession } from "./schemas.ts";
import { calculateTransition } from "./session.ts";

/** Optimistic replay preserves revision-gap behavior; the server validates conflicts. */
export function projectCommand(
  sessions: FocusSession[],
  command: FocusCommand,
): FocusSession[] {
  const input = command.input;
  if (command.type === "create") {
    const { id, intention, occurredAt } = command.input;
    if (sessions.some((session) => session.id === id)) return sessions;
    return [
      {
        id,
        intention,
        status: "running",
        elapsedMs: 0,
        runningSince: occurredAt,
        revision: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        completedAt: null,
        recapText: null,
        recapRevision: 0,
      },
      ...sessions,
    ];
  }
  if (!("sessionId" in input)) return sessions;
  return sessions.map((session) => {
    if (
      session.id !== input.sessionId ||
      session.revision > input.expectedRevision
    )
      return session;
    return {
      ...session,
      ...calculateTransition(session, input.action, parseISO(input.occurredAt)),
      runningSince: input.action === "resume" ? input.occurredAt : null,
      revision: input.expectedRevision + 1,
      updatedAt: input.occurredAt,
      completedAt: input.action === "finish" ? input.occurredAt : null,
    };
  });
}
