import {
  addMinutes,
  differenceInMilliseconds,
  isAfter,
  isBefore,
  isValid,
  minutesToMilliseconds,
  parseISO,
} from "date-fns";
import * as Match from "effect/Match";
import { z } from "zod";
import type {
  FocusSegment,
  FocusSession,
  SessionDetail,
  WorkEvent,
} from "./schemas.ts";

export function elapsedAt(session: FocusSession, now: number) {
  return (
    session.elapsedMs +
    (session.runningSince
      ? Math.max(0, now - parseISO(session.runningSince).getTime())
      : 0)
  );
}

export class SessionDomainError extends Error {
  readonly reason:
    | "invalid_event_time"
    | "backwards_transition"
    | "completed_session"
    | "invalid_transition";

  constructor(reason: SessionDomainError["reason"], message: string) {
    super(message);
    this.reason = reason;
    this.name = "SessionDomainError";
  }
}

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
    throw new SessionDomainError(
      "invalid_event_time",
      "Event time is invalid or more than five minutes ahead of the server",
    );
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
    throw new SessionDomainError(
      "backwards_transition",
      "Timer commands must follow the preceding transition",
    );
  return Match.value(`${session.status}:${action}` as const).pipe(
    Match.whenOr(
      "completed:pause",
      "completed:resume",
      "completed:finish",
      () => {
        throw new SessionDomainError(
          "completed_session",
          "This focus session is already complete",
        );
      },
    ),
    Match.whenOr("running:resume", "paused:pause", () => {
      throw new SessionDomainError(
        "invalid_transition",
        "The timer has changed; refresh before trying again",
      );
    }),
    Match.whenOr(
      "running:pause",
      "paused:resume",
      "running:finish",
      "paused:finish",
      () => calculateTransition(session, action, at),
    ),
    Match.exhaustive,
  );
}

/** Shared arithmetic; callers own canonical validation or optimistic replay policy. */
export function calculateTransition(
  session: FocusSession,
  action: "pause" | "resume" | "finish",
  at: Date,
) {
  const state = Match.value(action).pipe(
    Match.when("pause", () => ({
      status: "paused" as const,
      runningSince: null,
      completedAt: null,
    })),
    Match.when("resume", () => ({
      status: "running" as const,
      runningSince: at,
      completedAt: null,
    })),
    Match.when("finish", () => ({
      status: "completed" as const,
      runningSince: null,
      completedAt: at,
    })),
    Match.exhaustive,
  );
  return {
    elapsedMs: elapsedAt(session, at.getTime()),
    ...state,
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
  const { intervals, elapsedMs } = buildFocusIntervals(transitions, now);
  const { segments, segmentsTruncated } = buildFocusSegments(
    intervals,
    elapsedMs,
    events,
  );
  return {
    session,
    events,
    segments,
    segmentsTruncated,
    generatedRecap: buildGeneratedRecap(session, events),
  };
}

interface FocusInterval {
  start: Date;
  end: Date;
  offsetMs: number;
}

function buildFocusIntervals(transitions: Transition[], now: Date) {
  const intervals: FocusInterval[] = [];
  let startedAt: Date | null = null;
  let elapsedMs = 0;
  const closeInterval = (at: Date) => {
    if (startedAt === null) return;
    const endedAt = isBefore(at, startedAt) ? startedAt : at;
    intervals.push({ start: startedAt, end: endedAt, offsetMs: elapsedMs });
    elapsedMs += differenceInMilliseconds(endedAt, startedAt);
    startedAt = null;
  };
  for (const transition of transitions) {
    Match.value(transition.action).pipe(
      Match.whenOr("start", "resume", () => {
        startedAt = transition.occurredAt;
      }),
      Match.whenOr("pause", "finish", () => {
        closeInterval(transition.occurredAt);
      }),
      Match.exhaustive,
    );
  }
  closeInterval(now);
  return { intervals, elapsedMs };
}

function buildFocusSegments(
  intervals: FocusInterval[],
  elapsedMs: number,
  events: WorkEvent[],
) {
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
  return { segments, segmentsTruncated: segmentCount > MAX_SEGMENTS };
}

function buildGeneratedRecap(session: FocusSession, events: WorkEvent[]) {
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
  const notices = [
    {
      include: toolCount > 0,
      text: `${toolCount} tool completion event${toolCount === 1 ? "" : "s"} recorded.`,
    },
    {
      include: events.length === 0,
      text: "No work evidence recorded yet. Add a note or connect your CLI.",
    },
    {
      include:
        reported.length > 12 ||
        reported.some((event) => event.summary.length > 400),
      text: "Recap uses excerpts from the latest 12 reports. Complete evidence is available below.",
    },
    {
      include: sessionEvents.length < events.length,
      text: "Some CLI evidence falls outside the final session time and is excluded from this recap.",
    },
  ];
  return [
    session.intention,
    ...bullets,
    ...notices.filter(({ include }) => include).map(({ text }) => text),
  ].join("\n\n");
}
