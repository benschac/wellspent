import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { isAfter, isValid } from "date-fns";
import { z } from "zod";

export const calendarPublicationSelection = z
  .strictObject({
    sessionIds: z.array(z.uuid()).min(1).max(500),
  })
  .refine(({ sessionIds }) => new Set(sessionIds).size === sessionIds.length);

export const calendarPublicationPayload = z.object({
  sessionId: z.uuid(),
  revision: z.number().int().nonnegative(),
  event: z.object({
    id: z.string().regex(/^[0-9a-v]{5,1024}$/),
    summary: z.string(),
    description: z.string(),
    start: z.object({ dateTime: z.iso.datetime() }),
    end: z.object({ dateTime: z.iso.datetime() }),
    extendedProperties: z.object({ private: z.record(z.string(), z.string()) }),
    transparency: z.literal("transparent"),
  }),
});

export type CalendarPublication = z.infer<typeof calendarPublicationPayload>;

export function createCalendarPublication(
  connectionId: string,
  session: {
    id: string;
    revision: number;
    intention: string;
    createdAt: Date;
    completedAt: Date | null;
    elapsedMs: number;
    recapText: string | null;
    status: string;
  },
): CalendarPublication {
  if (
    session.status !== "completed" ||
    !session.completedAt ||
    !isValid(session.createdAt) ||
    !isValid(session.completedAt) ||
    !isAfter(session.completedAt, session.createdAt)
  ) {
    throw new BadRequestException(
      "Only completed sessions with a positive time span can be published",
    );
  }
  const id = createHash("sha256")
    .update(`${connectionId}:${session.id}`)
    .digest("hex");
  return {
    sessionId: session.id,
    revision: session.revision,
    event: {
      id,
      summary: session.intention,
      description: [
        `Focused time: ${session.elapsedMs / 1000} seconds (pauses excluded).`,
        "The calendar span includes pauses. Published from Well Spent.",
        session.recapText ?? "",
      ]
        .filter(Boolean)
        .join("\n\n")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
      start: { dateTime: session.createdAt.toISOString() },
      end: { dateTime: session.completedAt.toISOString() },
      extendedProperties: {
        private: { wellSpentSessionId: session.id, wellSpentPublicationId: id },
      },
      transparency: "transparent",
    },
  };
}
