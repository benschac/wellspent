import {
  asyncIteratorObject,
  error,
  oc,
  type Schema,
  type,
} from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import type { UIMessage, UIMessageChunk } from "ai";
import { z } from "zod";

const sessionIdInput = z.object({ sessionId: z.uuid() }).strict();
const evidenceUrl = z.url().max(2048).refine((value) => value.startsWith("https://"), "Evidence links must use HTTPS");

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

export const workEventInputSchema = z.object({
  id: z.uuid(),
  source: z.literal("codex"),
  sourceSessionId: z.string().min(1).max(256),
  occurredAt: z.iso.datetime(),
  kind: z.enum(["tool_completed", "turn_completed"]),
  summary: z.string().trim().min(1).max(2000),
  evidenceUrl: evidenceUrl.optional(),
}).strict();

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
export const createFocusInputSchema = z.object({
  id: z.uuid(), commandId: z.uuid(), intention: z.string().trim().min(1).max(500), occurredAt: z.iso.datetime(),
}).strict();
export const transitionFocusInputSchema = sessionIdInput.extend({
  commandId: z.uuid(), action: z.enum(["pause", "resume", "finish"]),
  expectedRevision: z.number().int().positive(), occurredAt: z.iso.datetime(),
});
export const updateRecapInputSchema = sessionIdInput.extend({
  text: z.string().trim().max(8000), expectedRevision: z.number().int().nonnegative(),
});
export const addFocusNoteInputSchema = sessionIdInput.extend({
  id: z.uuid(), occurredAt: z.iso.datetime(), summary: z.string().trim().min(1).max(2000), evidenceUrl: evidenceUrl.optional(),
});
export const ingestWorkEventsInputSchema = sessionIdInput.extend({events: z.array(workEventInputSchema).min(1).max(50)});

export const focusContract = {
  list: oc.meta(openapi({method: "GET", path: "/focus/sessions"})).output(z.array(focusSessionSchema)),
  create: oc.meta(openapi({method: "POST", path: "/focus/sessions"})).input(createFocusInputSchema).output(focusSessionSchema),
  get: oc.meta(openapi({method: "GET", path: "/focus/sessions/{sessionId}"})).input(sessionIdInput).output(focusDetailSchema),
  transition: oc.meta(openapi({method: "POST", path: "/focus/sessions/{sessionId}/transitions"})).input(transitionFocusInputSchema).output(focusSessionSchema),
  updateRecap: oc.meta(openapi({method: "PATCH", path: "/focus/sessions/{sessionId}/recap"})).input(updateRecapInputSchema).output(focusDetailSchema),
  addNote: oc.meta(openapi({method: "POST", path: "/focus/sessions/{sessionId}/notes"})).input(addFocusNoteInputSchema).output(focusDetailSchema),
  createCaptureToken: oc.meta(openapi({method: "POST", path: "/focus/sessions/{sessionId}/capture-token"})).input(sessionIdInput).output(z.object({token:z.string(),expiresAt:z.iso.datetime()})),
  revokeCaptureToken: oc.meta(openapi({method: "DELETE", path: "/focus/sessions/{sessionId}/capture-token"})).input(sessionIdInput).output(z.object({revoked:z.literal(true)})),
  ingest: oc.meta(openapi({method: "POST", path: "/focus/sessions/{sessionId}/work-events"})).input(ingestWorkEventsInputSchema).output(z.object({
    acceptedEventIds:z.array(z.uuid()),
    rejectedEvents:z.array(z.object({id:z.uuid(),reason:z.enum(["outside_session","future_timestamp","id_conflict","session_limit"])})),
  })),
};

export type FocusSession = z.infer<typeof focusSessionSchema>;
export type WorkEvent = z.infer<typeof workEventSchema>;
export type WorkEventInput = z.infer<typeof workEventInputSchema>;
export type FocusSegment = z.infer<typeof focusSegmentSchema>;
export type SessionDetail = z.infer<typeof focusDetailSchema>;
export type CreateFocusInput = z.infer<typeof createFocusInputSchema>;
export type TransitionFocusInput = z.infer<typeof transitionFocusInputSchema>;
export type UpdateRecapInput = z.infer<typeof updateRecapInputSchema>;
export type AddFocusNoteInput = z.infer<typeof addFocusNoteInputSchema>;

export const healthOutputSchema = z.object({
  service: z.literal("api"),
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
});

export const profileSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().trim().min(1).max(100).nullable(),
    avatarUrl: z.url().max(2_048).nullable(),
    timeZone: z.string().trim().min(1).max(100).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const updateProfileInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).nullable().optional(),
    avatarUrl: z.url().max(2_048).nullable().optional(),
    timeZone: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    "At least one profile field is required",
  );

const assistantMessagesSchema = z
  .array(z.unknown())
  .min(1)
  .max(50)
  .transform((messages) => messages as UIMessage[]);

export const assistantChatInputSchema = z
  .object({
    chatId: z.string().min(1).max(128),
    messages: assistantMessagesSchema,
  })
  .strict();

export const assistantNotConfiguredError = error("SERVICE_UNAVAILABLE", {
  message: "The focus assistant is not configured",
});

export const assistantInvalidMessagesError = error("BAD_REQUEST", {
  message: "The conversation contains invalid messages",
});

const assistantChatOutputSchema: Schema<
  AsyncIteratorObject<UIMessageChunk, unknown, void>,
  AsyncIteratorObject<UIMessageChunk, unknown, void>
> = asyncIteratorObject(type<UIMessageChunk>());

export const realtimePingEvent = "realtime.ping" as const;
export const realtimePongEvent = "realtime.pong" as const;
export const realtimeTimerCommandEvent = "timer.command" as const;
export const realtimeTimerLiveActivityRegisterEvent =
  "timer.live_activity.register" as const;
export const realtimeTimerStateEvent = "timer.state" as const;

export const realtimePingSchema = z
  .object({
    sentAt: z.iso.datetime(),
  })
  .strict();

export const realtimePongSchema = z.object({
  sentAt: z.iso.datetime(),
  serverTime: z.iso.datetime(),
});

export const realtimeTimerCommandSchema = z
  .object({
    action: z.enum(["start", "pause", "reset"]),
  })
  .strict();

export const realtimeTimerLiveActivityRegistrationSchema = z
  .object({
    activityId: z.string().min(1).max(256),
    pushToken: z.string().regex(/^[0-9a-f]+$/i).min(2).max(512),
    realtimeUrl: z
      .url()
      .refine((value) => value.startsWith("ws://") || value.startsWith("wss://")),
  })
  .strict();

export const realtimeTimerStateSchema = z
  .object({
    elapsedMs: z.number().finite().nonnegative(),
    isRunning: z.boolean(),
    revision: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const apiContract = {
  focus: focusContract,
  assistant: {
    chat: oc
      .meta(
        openapi({
          method: "POST",
          path: "/assistant/chat",
          summary: "Stream a focus assistant response",
          tags: ["assistant"],
        }),
      )
      .input(assistantChatInputSchema)
      .output(assistantChatOutputSchema)
      .errors({
        [assistantInvalidMessagesError.code]: assistantInvalidMessagesError,
        [assistantNotConfiguredError.code]: assistantNotConfiguredError,
      }),
  },
  health: oc
    .meta(
      openapi({
        method: "GET",
        path: "/health",
        summary: "Check API health",
        tags: ["health"],
      }),
    )
    .output(healthOutputSchema),
  profile: {
    get: oc
      .meta(
        openapi({
          method: "GET",
          path: "/profile",
          summary: "Get the current user's profile",
          tags: ["profile"],
        }),
      )
      .output(profileSchema),
    update: oc
      .meta(
        openapi({
          method: "PATCH",
          path: "/profile",
          summary: "Update the current user's profile",
          tags: ["profile"],
        }),
      )
      .input(updateProfileInputSchema)
      .output(profileSchema),
  },
};

export type AssistantChatInput = z.infer<typeof assistantChatInputSchema>;
export type HealthOutput = z.infer<typeof healthOutputSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;
export type RealtimePing = z.infer<typeof realtimePingSchema>;
export type RealtimePong = z.infer<typeof realtimePongSchema>;
export type RealtimeTimerCommand = z.infer<
  typeof realtimeTimerCommandSchema
>;
export type RealtimeTimerLiveActivityRegistration = z.infer<
  typeof realtimeTimerLiveActivityRegistrationSchema
>;
export type RealtimeTimerState = z.infer<typeof realtimeTimerStateSchema>;
