import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

export const healthOutputSchema = z.object({
  service: z.literal("api"),
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
});

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
};

export type HealthOutput = z.infer<typeof healthOutputSchema>;
export type RealtimePing = z.infer<typeof realtimePingSchema>;
export type RealtimePong = z.infer<typeof realtimePongSchema>;
export type RealtimeTimerCommand = z.infer<
  typeof realtimeTimerCommandSchema
>;
export type RealtimeTimerLiveActivityRegistration = z.infer<
  typeof realtimeTimerLiveActivityRegistrationSchema
>;
export type RealtimeTimerState = z.infer<typeof realtimeTimerStateSchema>;
