import { describe, expect, it } from "bun:test";
import type { FocusSession, WorkEvent } from "@repo/api-contract";
import { buildFocusDetail, MAX_SEGMENTS, SEGMENT_MS, transitionState, validateEventTime } from "../src/focus/focus-domain.js";

const start = new Date("2026-09-05T12:00:00Z");
const at = (minutes: number) => new Date(start.getTime() + minutes * 60000);
const session: FocusSession = {
  id: crypto.randomUUID(), intention: "Improve login reliability", status: "completed", elapsedMs: 45 * 60000,
  runningSince: null, revision: 4, createdAt: start.toISOString(), updatedAt: at(60).toISOString(), completedAt: at(60).toISOString(), recapText: null, recapRevision: 0,
};
const event = (minutes: number): WorkEvent => ({id: crypto.randomUUID(), source: "codex", sourceSessionId: "thread-1", occurredAt: at(minutes).toISOString(), kind: "turn_completed", summary: "Investigated refresh behavior", evidenceUrl: null});

describe("focus evidence projection", () => {
  it("splits 45 focused minutes into three sections while excluding a 15-minute pause", () => {
    const events = [event(14), event(15), event(25), event(30), event(45), event(60)];
    const detail = buildFocusDetail(session, [
      {action: "start", occurredAt: at(0)}, {action: "pause", occurredAt: at(20)},
      {action: "resume", occurredAt: at(35)}, {action: "finish", occurredAt: at(60)},
    ], events, at(90));
    expect(detail.segments.map((segment) => [segment.startOffsetMs, segment.endOffsetMs])).toEqual([[0,900000],[900000,1800000],[1800000,2700000]]);
    expect(detail.segments[0]?.events).toEqual([events[0]]);
    expect(detail.segments[1]?.events).toEqual([events[1]]);
    expect(detail.segments[2]?.events).toEqual([events[4]]);
    expect(detail.events).toHaveLength(6); // Pause/end observations remain visible without false time attribution.
    expect(detail.generatedRecap).toContain("Agent-reported:");
  });

  it("keeps a partial final section and marks lack of evidence honestly", () => {
    const result = buildFocusDetail({...session, status:"running",runningSince:start.toISOString()}, [{action:"start",occurredAt:start}], [], at(17));
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1]?.endOffsetMs).toBe(17 * 60000);
    expect(result.generatedRecap).toContain("No work evidence recorded");
  });

  it("bounds very long session rendering without changing stored timer duration", () => {
    const result = buildFocusDetail(session, [{action:"start",occurredAt:start}], [], new Date(start.getTime() + (MAX_SEGMENTS + 1) * SEGMENT_MS));
    expect(result.segments).toHaveLength(MAX_SEGMENTS);
    expect(result.segmentsTruncated).toBe(true);
  });

  it("does not pretend background tool count proves an outcome", () => {
    const tool = {...event(1),kind:"tool_completed" as const,summary:"Tool completed: Bash"};
    const result = buildFocusDetail(session,[{action:"start",occurredAt:start},{action:"finish",occurredAt:at(5)}],[tool],at(5));
    expect(result.generatedRecap).toContain("1 tool completion event recorded");
    expect(result.generatedRecap).not.toContain("shipped");
  });
  it("keeps generated recaps editable while preserving complete evidence", () => {
    const events = Array.from({length:20}, () => ({...event(1), summary:"x".repeat(2000)}));
    const result = buildFocusDetail(session,[{action:"start",occurredAt:start},{action:"finish",occurredAt:at(5)}],events,at(5));
    expect(result.generatedRecap.length).toBeLessThanOrEqual(8000);
    expect(result.generatedRecap).toContain("Recap uses excerpts");
    expect(result.events[0]?.summary).toHaveLength(2000);
  });
  it("recomputes attribution after an offline finish precedes already-received evidence", () => {
    const outside = {...event(10), summary:"Opened a second unrelated project"};
    const result = buildFocusDetail({...session,completedAt:at(5).toISOString()},[{action:"start",occurredAt:start},{action:"finish",occurredAt:at(5)}],[outside],at(15));
    expect(result.events).toEqual([outside]);
    expect(result.generatedRecap).not.toContain(outside.summary);
    expect(result.generatedRecap).toContain("excluded from this recap");
  });
});

describe("focus transitions", () => {
  it("preserves elapsed time through pause/resume and finish", () => {
    const running = {...session,status:"running" as const,runningSince:at(35).toISOString(),elapsedMs:20*60000};
    expect(transitionState(running,"finish",at(60),at(35))).toMatchObject({elapsedMs:45*60000,status:"completed",runningSince:null,revision:5});
    expect(transitionState({...running,status:"paused",runningSince:null},"resume",at(60),at(35))).toMatchObject({elapsedMs:20*60000,runningSince:at(60)});
  });
  it("rejects backwards commands, terminal changes and invalid lifecycle actions", () => {
    expect(() => transitionState(session,"resume",at(61),at(60))).toThrow("already complete");
    expect(() => transitionState({...session,status:"paused"},"pause",at(61),at(60))).toThrow("timer has changed");
    expect(() => transitionState({...session,status:"paused"},"resume",at(59),at(60))).toThrow("preceding transition");
  });
  it("rejects invalid/future time while allowing offline timestamps", () => {
    expect(() => validateEventTime(at(6).toISOString(),start)).toThrow();
    expect(() => validateEventTime("bad",start)).toThrow();
    expect(validateEventTime(start.toISOString(),at(60))).toEqual(start);
  });
});
