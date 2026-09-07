import { z } from "zod";

export const sessionIdInput = z.object({ sessionId: z.uuid() }).strict();
const evidenceUrl = z
  .url()
  .max(2048)
  .refine(
    (value) => value.startsWith("https://"),
    "Evidence links must use HTTPS",
  );

export const focusSessionSchema = z.object({
  id: z.uuid(),
  intention: z.string(),
  status: z.enum(["running", "paused", "completed"]),
  elapsedMs: z.number().nonnegative(),
  runningSince: z.iso.datetime().nullable(),
  revision: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  recapText: z.string().nullable(),
  recapRevision: z.number().int(),
});

export const workEventInputSchema = z
  .object({
    id: z.uuid(),
    source: z.literal("codex"),
    sourceSessionId: z.string().min(1).max(256),
    occurredAt: z.iso.datetime(),
    kind: z.enum(["tool_completed", "turn_completed"]),
    summary: z.string().trim().min(1).max(2000),
    evidenceUrl: evidenceUrl.optional(),
  })
  .strict();

export const workEventSchema = z.object({
  id: z.uuid(),
  source: z.enum(["codex", "manual"]),
  sourceSessionId: z.string(),
  occurredAt: z.iso.datetime(),
  kind: z.enum(["tool_completed", "turn_completed", "note"]),
  summary: z.string(),
  evidenceUrl: z.string().nullable(),
});

export const focusSegmentSchema = z.object({
  index: z.number().int(),
  startOffsetMs: z.number(),
  endOffsetMs: z.number(),
  events: z.array(workEventSchema),
});
export const focusDetailSchema = z.object({
  session: focusSessionSchema,
  events: z.array(workEventSchema),
  segments: z.array(focusSegmentSchema),
  generatedRecap: z.string(),
  segmentsTruncated: z.boolean(),
});
// Legacy persisted commands preserve whitespace and strip unknown keys.
// HTTP inputs derive these fields but retain their strict, trimmed boundary.
export const storedCreateFocusInputSchema = z.object({
  id: z.uuid(),
  commandId: z.uuid(),
  intention: z.string().min(1).max(500),
  occurredAt: z.iso.datetime(),
});
export const createFocusInputSchema = storedCreateFocusInputSchema
  .extend({
    intention: z.string().trim().min(1).max(500),
  })
  .strict();
export const transitionFocusInputSchema = sessionIdInput.extend({
  commandId: z.uuid(),
  action: z.enum(["pause", "resume", "finish"]),
  expectedRevision: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
});
export const updateRecapInputSchema = sessionIdInput.extend({
  text: z.string().trim().max(8000),
  expectedRevision: z.number().int().nonnegative(),
});
export const addFocusNoteInputSchema = sessionIdInput.extend({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  summary: z.string().trim().min(1).max(2000),
  evidenceUrl: evidenceUrl.optional(),
});
export const ingestWorkEventsInputSchema = sessionIdInput.extend({
  events: z.array(workEventInputSchema).min(1).max(50),
});

export const commandsSchema = z
  .array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("create"),
        input: storedCreateFocusInputSchema,
      }),
      z.object({
        type: z.literal("transition"),
        input: z.object(transitionFocusInputSchema.shape),
      }),
    ]),
  )
  .max(1000);
export type FocusCommand = z.infer<typeof commandsSchema>[number];

export type FocusSession = z.infer<typeof focusSessionSchema>;
export type WorkEvent = z.infer<typeof workEventSchema>;
export type WorkEventInput = z.infer<typeof workEventInputSchema>;
export type FocusSegment = z.infer<typeof focusSegmentSchema>;
export type SessionDetail = z.infer<typeof focusDetailSchema>;
export type CreateFocusInput = z.infer<typeof createFocusInputSchema>;
export type TransitionFocusInput = z.infer<typeof transitionFocusInputSchema>;
export type UpdateRecapInput = z.infer<typeof updateRecapInputSchema>;
export type AddFocusNoteInput = z.infer<typeof addFocusNoteInputSchema>;
