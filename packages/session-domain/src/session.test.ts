import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commandsSchema,
  createFocusInputSchema,
  elapsedAt,
  projectCommand,
  SessionDomainError,
  transitionFocusInputSchema,
  transitionState,
  validateEventTime,
} from "./index.ts";
import { finish, pause, resume, start } from "./testing.ts";

test("persisted commands retain their original shape while HTTP inputs keep their strict normalization", () => {
  const input = { ...start.input, intention: "  Fix login  " };
  const [stored] = commandsSchema.parse([
    { ...start, input: { ...input, extra: true }, extra: true },
  ]);
  assert.deepEqual(stored, { ...start, input });
  assert.equal(createFocusInputSchema.parse(input).intention, "Fix login");
  assert.equal(
    createFocusInputSchema.safeParse({ ...input, extra: true }).success,
    false,
  );
  assert.equal(
    createFocusInputSchema.safeParse({ ...input, intention: "   " }).success,
    false,
  );
  assert.equal(
    transitionFocusInputSchema.safeParse({ ...pause.input, extra: true })
      .success,
    false,
  );
  assert.deepEqual(
    commandsSchema.parse([
      { ...pause, input: { ...pause.input, extra: true } },
    ]),
    [pause],
  );
});

test("replay retains millisecond precision, independent recaps and acknowledged commands", () => {
  const preciseStart = {
    ...start,
    input: { ...start.input, occurredAt: "2026-09-05T12:00:00.123Z" },
  };
  const precisePause = {
    ...pause,
    input: { ...pause.input, occurredAt: "2026-09-05T12:15:00.456Z" },
  };
  const [created] = projectCommand([], preciseStart);
  assert.ok(created);
  const baseline = { ...created, recapText: "My recap", recapRevision: 8 };
  const [paused] = projectCommand([baseline], precisePause);
  assert.ok(paused);
  assert.equal(paused.elapsedMs, 900333);
  assert.equal(paused.updatedAt, precisePause.input.occurredAt);
  assert.equal(paused.createdAt, preciseStart.input.occurredAt);
  assert.equal(paused.recapText, baseline.recapText);
  assert.equal(paused.recapRevision, baseline.recapRevision);
  assert.deepEqual(projectCommand([paused], precisePause), [paused]);
  assert.equal(
    elapsedAt(created, new Date("2026-09-05T11:00:00Z").getTime()),
    0,
  );
});

test("paused finish and optimistic revision gaps preserve established replay policy", () => {
  const [paused] = [start, pause].reduce(projectCommand, []);
  assert.ok(paused);
  const [finished] = projectCommand([paused], finish);
  assert.ok(finished);
  assert.equal(finished.elapsedMs, 900000);
  assert.equal(finished.status, "completed");
  assert.equal(finished.revision, 4);
  assert.deepEqual(projectCommand([finished], resume), [finished]);
});

test("domain failures remain independent of HTTP and future-time boundary is inclusive", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  assert.equal(
    validateEventTime("2026-09-05T12:05:00.000Z", now).getTime(),
    now.getTime() + 300000,
  );
  assert.throws(
    () => validateEventTime("2026-09-05T12:05:00.001Z", now),
    (error: unknown) =>
      error instanceof SessionDomainError &&
      error.reason === "invalid_event_time",
  );
  const [completed] = [start, pause, resume, finish].reduce(projectCommand, []);
  assert.ok(completed);
  assert.throws(
    () => transitionState(completed, "resume", now, now),
    (error: unknown) =>
      error instanceof SessionDomainError &&
      error.reason === "completed_session",
  );
});

test("backwards timestamps take precedence over completed and invalid transitions", () => {
  const [paused] = [start, pause].reduce(projectCommand, []);
  const [completed] = [start, pause, finish].reduce(projectCommand, []);
  assert.ok(paused);
  assert.ok(completed);
  const previousAt = new Date("2026-09-05T13:00:00Z");
  const at = new Date("2026-09-05T12:00:00Z");
  for (const session of [paused, completed]) {
    assert.throws(
      () => transitionState(session, "pause", at, previousAt),
      (error: unknown) =>
        error instanceof SessionDomainError &&
        error.reason === "backwards_transition",
    );
  }
});
