import type { ApiClient } from "@repo/api-client";
import { z } from "zod";

export type FocusSession = Awaited<ReturnType<ApiClient["focus"]["create"]>>;
export type FocusDetail = Awaited<ReturnType<ApiClient["focus"]["get"]>>;
const createSchema = z.object({
  type: z.literal("create"),
  input: z.object({
    id: z.uuid(),
    commandId: z.uuid(),
    intention: z.string().min(1).max(500),
    occurredAt: z.iso.datetime(),
  }),
});
const transitionSchema = z.object({
  type: z.literal("transition"),
  input: z.object({
    sessionId: z.uuid(),
    commandId: z.uuid(),
    action: z.enum(["pause", "resume", "finish"]),
    expectedRevision: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
  }),
});
export const commandsSchema = z
  .array(z.discriminatedUnion("type", [createSchema, transitionSchema]))
  .max(1000);
export type FocusCommand = z.infer<typeof commandsSchema>[number];

export function elapsedAt(session: FocusSession, now: number) {
  return (
    session.elapsedMs +
    (session.runningSince
      ? Math.max(0, now - Date.parse(session.runningSince))
      : 0)
  );
}

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
      elapsedMs: elapsedAt(session, Date.parse(input.occurredAt)),
      status:
        input.action === "finish"
          ? "completed"
          : input.action === "pause"
            ? "paused"
            : "running",
      runningSince: input.action === "resume" ? input.occurredAt : null,
      revision: input.expectedRevision + 1,
      updatedAt: input.occurredAt,
      completedAt: input.action === "finish" ? input.occurredAt : null,
    };
  });
}

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
