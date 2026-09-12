import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

export const workLogEventInputSchema = z
  .object({
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    source: z.enum(["codex", "cli", "mcp"]),
    sourceSessionId: z.string().min(1).max(256),
    kind: z.enum(["tool_completed", "turn_completed", "note"]),
    summary: z.string().trim().min(1).max(2000),
    project: z.string().trim().min(1).max(200).optional(),
    sessionId: z.uuid().optional(),
  })
  .strict();
export const workLogEntrySchema = workLogEventInputSchema.extend({
  receivedAt: z.iso.datetime(),
});
export const workLogCursorSchema = z
  .object({ occurredAt: z.iso.datetime(), id: z.uuid() })
  .strict();
export const workLogListInputSchema = z
  .object({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    before: workLogCursorSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const workLogTokenSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});
export const workLogContract = {
  identity: oc
    .meta(openapi({ method: "GET", path: "/work-log/identity" }))
    .output(z.object({ userId: z.uuid() })),
  ingest: oc
    .meta(openapi({ method: "POST", path: "/work-log/events" }))
    .input(
      z
        .object({ events: z.array(workLogEventInputSchema).min(1).max(50) })
        .strict(),
    )
    .output(
      z.object({
        acceptedEventIds: z.array(z.uuid()),
        rejectedEvents: z.array(
          z.object({
            id: z.uuid(),
            reason: z.enum([
              "future_timestamp",
              "id_conflict",
              "session_not_found",
            ]),
          }),
        ),
      }),
    ),
  list: oc
    .meta(openapi({ method: "GET", path: "/work-log/events" }))
    .input(workLogListInputSchema)
    .output(
      z.object({
        entries: z.array(workLogEntrySchema),
        nextCursor: workLogCursorSchema.nullable(),
      }),
    ),
  createToken: oc
    .meta(openapi({ method: "POST", path: "/work-log/tokens" }))
    .input(z.object({ label: z.string().trim().min(1).max(100) }).strict())
    .output(
      z.object({
        id: z.uuid(),
        userId: z.uuid(),
        token: z.string(),
        expiresAt: z.iso.datetime(),
      }),
    ),
  listTokens: oc
    .meta(openapi({ method: "GET", path: "/work-log/tokens" }))
    .output(z.array(workLogTokenSchema)),
  revokeToken: oc
    .meta(openapi({ method: "DELETE", path: "/work-log/tokens/{id}" }))
    .input(z.object({ id: z.uuid() }).strict())
    .output(z.object({ revoked: z.literal(true) })),
};
export type WorkLogEventInput = z.infer<typeof workLogEventInputSchema>;
export type WorkLogEntry = z.infer<typeof workLogEntrySchema>;
export type WorkLogListInput = z.infer<typeof workLogListInputSchema>;
