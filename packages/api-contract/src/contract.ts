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

export const realtimePingSchema = z
  .object({
    sentAt: z.iso.datetime(),
  })
  .strict();

export const realtimePongSchema = z.object({
  sentAt: z.iso.datetime(),
  serverTime: z.iso.datetime(),
});

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
