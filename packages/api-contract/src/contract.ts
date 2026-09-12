import {
  asyncIteratorObject,
  error,
  oc,
  type Schema,
  type,
} from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import {
  addFocusNoteInputSchema,
  createFocusInputSchema,
  focusDetailSchema,
  focusSessionSchema,
  ingestWorkEventsInputSchema,
  sessionIdInput,
  transitionFocusInputSchema,
  updateRecapInputSchema,
} from "@repo/session-domain";
import type { UIMessage, UIMessageChunk } from "ai";
import { z } from "zod";
import { workLogContract } from "./work-log.ts";
export * from "./work-log.ts";

export type {
  AddFocusNoteInput,
  CreateFocusInput,
  FocusSegment,
  FocusSession,
  SessionDetail,
  TransitionFocusInput,
  UpdateRecapInput,
  WorkEvent,
  WorkEventInput,
} from "@repo/session-domain";
export {
  addFocusNoteInputSchema,
  createFocusInputSchema,
  focusDetailSchema,
  focusSegmentSchema,
  focusSessionSchema,
  ingestWorkEventsInputSchema,
  transitionFocusInputSchema,
  updateRecapInputSchema,
  workEventInputSchema,
  workEventSchema,
} from "@repo/session-domain";
export {
  focusChangedEvent,
  focusChangedSchema,
  focusNotificationTopic,
} from "./focus-notifications.ts";

export const focusContract = {
  list: oc
    .meta(openapi({ method: "GET", path: "/focus/sessions" }))
    .output(z.array(focusSessionSchema)),
  create: oc
    .meta(openapi({ method: "POST", path: "/focus/sessions" }))
    .input(createFocusInputSchema)
    .output(focusSessionSchema),
  get: oc
    .meta(openapi({ method: "GET", path: "/focus/sessions/{sessionId}" }))
    .input(sessionIdInput)
    .output(focusDetailSchema),
  transition: oc
    .meta(
      openapi({
        method: "POST",
        path: "/focus/sessions/{sessionId}/transitions",
      }),
    )
    .input(transitionFocusInputSchema)
    .output(focusSessionSchema),
  updateRecap: oc
    .meta(
      openapi({ method: "PATCH", path: "/focus/sessions/{sessionId}/recap" }),
    )
    .input(updateRecapInputSchema)
    .output(focusDetailSchema),
  addNote: oc
    .meta(
      openapi({ method: "POST", path: "/focus/sessions/{sessionId}/notes" }),
    )
    .input(addFocusNoteInputSchema)
    .output(focusDetailSchema),
  createCaptureToken: oc
    .meta(
      openapi({
        method: "POST",
        path: "/focus/sessions/{sessionId}/capture-token",
      }),
    )
    .input(sessionIdInput)
    .output(z.object({ token: z.string(), expiresAt: z.iso.datetime() })),
  revokeCaptureToken: oc
    .meta(
      openapi({
        method: "DELETE",
        path: "/focus/sessions/{sessionId}/capture-token",
      }),
    )
    .input(sessionIdInput)
    .output(z.object({ revoked: z.literal(true) })),
  ingest: oc
    .meta(
      openapi({
        method: "POST",
        path: "/focus/sessions/{sessionId}/work-events",
      }),
    )
    .input(ingestWorkEventsInputSchema)
    .output(
      z.object({
        acceptedEventIds: z.array(z.uuid()),
        rejectedEvents: z.array(
          z.object({
            id: z.uuid(),
            reason: z.enum([
              "outside_session",
              "future_timestamp",
              "id_conflict",
              "session_limit",
            ]),
          }),
        ),
      }),
    ),
};

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
export const realtimeTimerCommandAckEvent = "timer.command.ack" as const;
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
    // Correlates a reply to this request; it is not a durable idempotency key.
    commandId: z.string().min(1).max(128).optional(),
  })
  .strict();

export const realtimeTimerLiveActivityRegistrationSchema = z
  .object({
    activityId: z.string().min(1).max(256),
    pushToken: z
      .string()
      .regex(/^[0-9a-f]+$/i)
      .min(2)
      .max(512),
    realtimeUrl: z
      .url()
      .refine(
        (value) => value.startsWith("ws://") || value.startsWith("wss://"),
      ),
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

export const realtimeTimerCommandAckSchema = z
  .object({
    commandId: z.string().min(1).max(128),
    state: realtimeTimerStateSchema,
  })
  .strict();

export const apiContract = {
  workLog: workLogContract,
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
export type RealtimeTimerCommand = z.infer<typeof realtimeTimerCommandSchema>;
export type RealtimeTimerCommandAck = z.infer<
  typeof realtimeTimerCommandAckSchema
>;
export type RealtimeTimerLiveActivityRegistration = z.infer<
  typeof realtimeTimerLiveActivityRegistrationSchema
>;
export type RealtimeTimerState = z.infer<typeof realtimeTimerStateSchema>;
