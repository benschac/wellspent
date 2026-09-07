import { describe, expect, it } from "bun:test";
import { ORPCError } from "@orpc/server";
import type { FocusSession, WorkEvent } from "@repo/api-contract";
import {
  createFocusInputSchema,
  transitionFocusInputSchema,
} from "@repo/api-contract";
import { projectCommand } from "@repo/session-domain";
import {
  finish as finishCommand,
  pause as pauseCommand,
  resume as resumeCommand,
  start as startCommand,
} from "@repo/session-domain/testing";
import { parseISO } from "date-fns";
import {
  buildFocusDetail,
  MAX_SEGMENTS,
  SEGMENT_MS,
  transitionState,
  validateEventTime,
} from "../src/focus/focus-domain.js";

const start = new Date("2026-09-05T12:00:00Z");
const at = (minutes: number) => new Date(start.getTime() + minutes * 60000);
const session: FocusSession = {
  id: crypto.randomUUID(),
  intention: "Improve login reliability",
  status: "completed",
  elapsedMs: 45 * 60000,
  runningSince: null,
  revision: 4,
  createdAt: start.toISOString(),
  updatedAt: at(60).toISOString(),
  completedAt: at(60).toISOString(),
  recapText: null,
  recapRevision: 0,
};
const event = (minutes: number): WorkEvent => ({
  id: crypto.randomUUID(),
  source: "codex",
  sourceSessionId: "thread-1",
  occurredAt: at(minutes).toISOString(),
  kind: "turn_completed",
  summary: "Investigated refresh behavior",
  evidenceUrl: null,
});

describe("focus evidence projection", () => {
  it("includes interval starts but excludes pause and finish boundaries", () => {
    const events = [event(0), event(5), event(10), event(15)];
    const result = buildFocusDetail(
      session,
      [
        { action: "start", occurredAt: at(0) },
        { action: "pause", occurredAt: at(5) },
        { action: "resume", occurredAt: at(10) },
        { action: "finish", occurredAt: at(15) },
      ],
      events,
      at(30),
    );
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.endOffsetMs).toBe(10 * 60000);
    expect(result.segments[0]?.events).toEqual([events[0], events[2]]);
    expect(result.events).toEqual(events);
  });

  it("ignores closes without an open interval and clamps backwards interval ends", () => {
    const result = buildFocusDetail(
      session,
      [
        { action: "pause", occurredAt: at(0) },
        { action: "start", occurredAt: at(10) },
        { action: "pause", occurredAt: at(5) },
        { action: "finish", occurredAt: at(15) },
        { action: "resume", occurredAt: at(20) },
      ],
      [event(10)],
      at(15),
    );
    expect(result.segments).toEqual([]);
    expect(result.segmentsTruncated).toBe(false);
  });

  it("splits 45 focused minutes into three sections while excluding a 15-minute pause", () => {
    const events = [
      event(14),
      event(15),
      event(25),
      event(30),
      event(45),
      event(60),
    ];
    const detail = buildFocusDetail(
      session,
      [
        { action: "start", occurredAt: at(0) },
        { action: "pause", occurredAt: at(20) },
        { action: "resume", occurredAt: at(35) },
        { action: "finish", occurredAt: at(60) },
      ],
      events,
      at(90),
    );
    expect(
      detail.segments.map((segment) => [
        segment.startOffsetMs,
        segment.endOffsetMs,
      ]),
    ).toEqual([
      [0, 900000],
      [900000, 1800000],
      [1800000, 2700000],
    ]);
    expect(detail.segments[0]?.events).toEqual([events[0]]);
    expect(detail.segments[1]?.events).toEqual([events[1]]);
    expect(detail.segments[2]?.events).toEqual([events[4]]);
    expect(detail.events).toHaveLength(6); // Pause/end observations remain visible without false time attribution.
    expect(detail.generatedRecap).toContain("Agent-reported:");
  });

  it("keeps a partial final section and marks lack of evidence honestly", () => {
    const result = buildFocusDetail(
      { ...session, status: "running", runningSince: start.toISOString() },
      [{ action: "start", occurredAt: start }],
      [],
      at(17),
    );
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1]?.endOffsetMs).toBe(17 * 60000);
    expect(result.generatedRecap).toContain("No work evidence recorded");
  });

  it("bounds very long session rendering without changing stored timer duration", () => {
    const result = buildFocusDetail(
      session,
      [{ action: "start", occurredAt: start }],
      [],
      new Date(start.getTime() + (MAX_SEGMENTS + 1) * SEGMENT_MS),
    );
    expect(result.segments).toHaveLength(MAX_SEGMENTS);
    expect(result.segmentsTruncated).toBe(true);
  });

  it("does not pretend background tool count proves an outcome", () => {
    const tool = {
      ...event(1),
      kind: "tool_completed" as const,
      summary: "Tool completed: Bash",
    };
    const result = buildFocusDetail(
      session,
      [
        { action: "start", occurredAt: start },
        { action: "finish", occurredAt: at(5) },
      ],
      [tool],
      at(5),
    );
    expect(result.generatedRecap).toContain("1 tool completion event recorded");
    expect(result.generatedRecap).not.toContain("shipped");
  });
  it("keeps generated recaps editable while preserving complete evidence", () => {
    const events = Array.from({ length: 20 }, () => ({
      ...event(1),
      summary: "x".repeat(2000),
    }));
    const result = buildFocusDetail(
      session,
      [
        { action: "start", occurredAt: start },
        { action: "finish", occurredAt: at(5) },
      ],
      events,
      at(5),
    );
    expect(result.generatedRecap.length).toBeLessThanOrEqual(8000);
    expect(result.generatedRecap).toContain("Recap uses excerpts");
    expect(result.events[0]?.summary).toHaveLength(2000);
  });
  it("recomputes attribution after an offline finish precedes already-received evidence", () => {
    const outside = {
      ...event(10),
      summary: "Opened a second unrelated project",
    };
    const result = buildFocusDetail(
      { ...session, completedAt: at(5).toISOString() },
      [
        { action: "start", occurredAt: start },
        { action: "finish", occurredAt: at(5) },
      ],
      [outside],
      at(15),
    );
    expect(result.events).toEqual([outside]);
    expect(result.generatedRecap).not.toContain(outside.summary);
    expect(result.generatedRecap).toContain("excluded from this recap");
  });
});

describe("focus transitions", () => {
  it("preserves elapsed time through pause/resume and finish", () => {
    const running = {
      ...session,
      status: "running" as const,
      runningSince: at(35).toISOString(),
      elapsedMs: 20 * 60000,
    };
    expect(transitionState(running, "finish", at(60), at(35))).toMatchObject({
      elapsedMs: 45 * 60000,
      status: "completed",
      runningSince: null,
      revision: 5,
    });
    expect(
      transitionState(
        { ...running, status: "paused", runningSince: null },
        "resume",
        at(60),
        at(35),
      ),
    ).toMatchObject({ elapsedMs: 20 * 60000, runningSince: at(60) });
  });
  it("rejects backwards commands, terminal changes and invalid lifecycle actions", () => {
    expect(() => transitionState(session, "resume", at(61), at(60))).toThrow(
      "already complete",
    );
    expect(() =>
      transitionState(
        { ...session, status: "paused" },
        "pause",
        at(61),
        at(60),
      ),
    ).toThrow("timer has changed");
    expect(() =>
      transitionState(
        { ...session, status: "paused" },
        "resume",
        at(59),
        at(60),
      ),
    ).toThrow("preceding transition");
  });
  it("rejects invalid/future time while allowing offline timestamps", () => {
    expect(() => validateEventTime(at(6).toISOString(), start)).toThrow();
    expect(() => validateEventTime("bad", start)).toThrow();
    expect(validateEventTime(start.toISOString(), at(60))).toEqual(start);
  });
});

describe("shared session lifecycle", () => {
  it("matches browser projection for every persisted command without changing recap revisions", () => {
    let sessions: FocusSession[] = [];
    let previousAt = parseISO(startCommand.input.occurredAt);
    for (const command of [
      startCommand,
      pauseCommand,
      resumeCommand,
      finishCommand,
    ]) {
      const projected = projectCommand(sessions, command);
      const next = projected[0];
      if (next === undefined) throw new Error("Missing projected session");
      if (command.type === "transition") {
        const current = sessions[0];
        if (current === undefined) throw new Error("Missing preceding session");
        const input = transitionFocusInputSchema.parse(command.input);
        const at = validateEventTime(
          input.occurredAt,
          new Date("2026-09-06T00:00:00Z"),
        );
        const canonical = transitionState(
          current,
          input.action,
          at,
          previousAt,
        );
        expect(next).toEqual({
          ...current,
          ...canonical,
          runningSince: canonical.runningSince?.toISOString() ?? null,
          completedAt: canonical.completedAt?.toISOString() ?? null,
          updatedAt: input.occurredAt,
        });
        expect(next.recapRevision).toBe(7);
        expect(next.recapText).toBe("User recap");
        previousAt = at;
      } else {
        expect(createFocusInputSchema.parse(command.input)).toEqual(
          command.input,
        );
        next.recapRevision = 7;
        next.recapText = "User recap";
      }
      sessions = projected;
    }
    expect(sessions[0]?.elapsedMs).toBe(30 * 60_000);
    expect(
      [startCommand, pauseCommand, resumeCommand, finishCommand].reduce(
        projectCommand,
        sessions,
      ),
    ).toEqual(sessions);
  });

  it("maps domain failures to the established HTTP codes", () => {
    try {
      validateEventTime("invalid", start);
      throw new Error("Expected invalid time rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.code).toBe("BAD_REQUEST");
    }
    try {
      transitionState(session, "resume", at(61), at(60));
      throw new Error("Expected completed session rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.code).toBe("CONFLICT");
    }
  });
});
