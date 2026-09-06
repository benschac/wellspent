import { ORPCError } from "@orpc/server";
import type {
  FocusSegment,
  FocusSession,
  SessionDetail,
  WorkEvent,
} from "@repo/api-contract";
import {
  addMinutes,
  differenceInMilliseconds,
  isAfter,
  isBefore,
  isValid,
  minutesToMilliseconds,
  parseISO,
} from "date-fns";
import { z } from "zod";

export const SEGMENT_MS = minutesToMilliseconds(15);
export const MAX_SEGMENTS = 672;
export const MAX_EVENTS = 2000;
const eventTimeSchema = z.iso
  .datetime()
  .transform((value) => parseISO(value))
  .refine(isValid);

export interface Transition {
  action: "start" | "pause" | "resume" | "finish";
  occurredAt: Date;
}

export function validateEventTime(value: string, now: Date): Date {
  const result = eventTimeSchema.safeParse(value);
  if (!result.success || isAfter(result.data, addMinutes(now, 5))) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Event time is invalid or more than five minutes ahead of the server",
    });
  }
  return result.data;
}

export function transitionState(
  session: FocusSession,
  action: "pause" | "resume" | "finish",
  at: Date,
  previousAt: Date,
) {
  if (isBefore(at, previousAt))
    throw new ORPCError("CONFLICT", {
      message: "Timer commands must follow the preceding transition",
    });
  if (session.status === "completed")
    throw new ORPCError("CONFLICT", {
      message: "This focus session is already complete",
    });
  if (
    (action === "resume" && session.status !== "paused") ||
    (action === "pause" && session.status !== "running")
  ) {
    throw new ORPCError("CONFLICT", {
      message: "The timer has changed; refresh before trying again",
    });
  }
  return {
    elapsedMs:
      session.elapsedMs +
      (session.runningSince === null
        ? 0
        : Math.max(
            0,
            differenceInMilliseconds(at, parseISO(session.runningSince)),
          )),
    status:
      action === "finish"
        ? ("completed" as const)
        : action === "pause"
          ? ("paused" as const)
          : ("running" as const),
    runningSince: action === "resume" ? at : null,
    completedAt: action === "finish" ? at : null,
    revision: session.revision + 1,
  };
}

/** Timestamped evidence locates an observation; it never proves continuous human attention. */
export function buildFocusDetail(
  session: FocusSession,
  transitions: Transition[],
  events: WorkEvent[],
  now: Date,
): SessionDetail {
  const intervals: { start: Date; end: Date; offsetMs: number }[] = [];
  let startedAt: Date | null = null;
  let elapsedMs = 0;
  for (const transition of transitions) {
    if (transition.action === "start" || transition.action === "resume")
      startedAt = transition.occurredAt;
    else if (startedAt !== null) {
      const endedAt = isBefore(transition.occurredAt, startedAt)
        ? startedAt
        : transition.occurredAt;
      intervals.push({ start: startedAt, end: endedAt, offsetMs: elapsedMs });
      elapsedMs += differenceInMilliseconds(endedAt, startedAt);
      startedAt = null;
    }
  }
  if (startedAt !== null) {
    const endedAt = isBefore(now, startedAt) ? startedAt : now;
    intervals.push({ start: startedAt, end: endedAt, offsetMs: elapsedMs });
    elapsedMs += differenceInMilliseconds(endedAt, startedAt);
  }
  const segmentCount = Math.ceil(elapsedMs / SEGMENT_MS);
  const segments: FocusSegment[] = Array.from(
    { length: Math.min(MAX_SEGMENTS, segmentCount) },
    (_, index) => ({
      index,
      startOffsetMs: index * SEGMENT_MS,
      endOffsetMs: Math.min(elapsedMs, (index + 1) * SEGMENT_MS),
      events: [],
    }),
  );
  for (const event of events) {
    const occurredAt = parseISO(event.occurredAt);
    const interval = intervals.find(
      ({ start, end }) =>
        !isBefore(occurredAt, start) && isBefore(occurredAt, end),
    );
    if (interval === undefined) continue;
    const index = Math.floor(
      (interval.offsetMs +
        differenceInMilliseconds(occurredAt, interval.start)) /
        SEGMENT_MS,
    );
    segments[index]?.events.push(event);
  }
  // A delayed timer finish can move previously ingested events outside the session.
  // Keep all evidence visible, but do not attribute those agent claims to this recap.
  const sessionStartedAt = parseISO(session.createdAt);
  const sessionCompletedAt =
    session.completedAt === null ? null : parseISO(session.completedAt);
  const sessionEvents = events.filter((event) => {
    if (event.source === "manual") return true;
    const occurredAt = parseISO(event.occurredAt);
    return (
      !isBefore(occurredAt, sessionStartedAt) &&
      (sessionCompletedAt === null || !isAfter(occurredAt, sessionCompletedAt))
    );
  });
  const reported = sessionEvents.filter(
    (event) => event.kind === "note" || event.kind === "turn_completed",
  );
  const excerpt = (value: string) =>
    value.length > 400 ? `${value.slice(0, 399)}…` : value;
  const bullets = reported
    .slice(-12)
    .map(
      (event) =>
        `${event.source === "manual" ? "Your note" : "Agent-reported"}: ${excerpt(event.summary)}`,
    );
  const toolCount = sessionEvents.filter(
    (event) => event.kind === "tool_completed",
  ).length;
  return {
    session,
    events,
    segments,
    segmentsTruncated: segmentCount > MAX_SEGMENTS,
    generatedRecap: [
      session.intention,
      ...bullets,
      ...(toolCount > 0
        ? [
            `${toolCount} tool completion event${toolCount === 1 ? "" : "s"} recorded.`,
          ]
        : []),
      ...(events.length === 0
        ? ["No work evidence recorded yet. Add a note or connect your CLI."]
        : []),
      ...(reported.length > 12 ||
      reported.some((event) => event.summary.length > 400)
        ? [
            "Recap uses excerpts from the latest 12 reports. Complete evidence is available below.",
          ]
        : []),
      ...(sessionEvents.length < events.length
        ? [
            "Some CLI evidence falls outside the final session time and is excluded from this recap.",
          ]
        : []),
    ].join("\n\n"),
  };
}
