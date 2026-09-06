import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commandsSchema,
  elapsedAt,
  projectCommand,
  type FocusCommand,
} from "./focus-state";

const sessionId = "10000000-0000-4000-8000-000000000001";
const start: FocusCommand = {
  type: "create",
  input: {
    id: sessionId,
    commandId: "20000000-0000-4000-8000-000000000001",
    intention: "Fix login",
    occurredAt: "2026-09-05T12:00:00.000Z",
  },
};
const pause: FocusCommand = {
  type: "transition",
  input: {
    sessionId,
    commandId: "20000000-0000-4000-8000-000000000002",
    action: "pause",
    expectedRevision: 1,
    occurredAt: "2026-09-05T12:15:00.000Z",
  },
};
const resume: FocusCommand = {
  type: "transition",
  input: {
    sessionId,
    commandId: "20000000-0000-4000-8000-000000000003",
    action: "resume",
    expectedRevision: 2,
    occurredAt: "2026-09-05T12:45:00.000Z",
  },
};
const finish: FocusCommand = {
  type: "transition",
  input: {
    sessionId,
    commandId: "20000000-0000-4000-8000-000000000004",
    action: "finish",
    expectedRevision: 3,
    occurredAt: "2026-09-05T13:00:00.000Z",
  },
};

test("persisted offline commands replay their original timestamps and exclude a long pause", () => {
  const commands = commandsSchema.parse(
    JSON.parse(JSON.stringify([start, pause, resume, finish])),
  );
  const [session] = commands.reduce(projectCommand, []);
  assert.ok(session);
  assert.equal(session.elapsedMs, 30 * 60_000);
  assert.equal(session.status, "completed");
  assert.equal(session.revision, 4);
  assert.equal(
    elapsedAt(session, Date.parse("2026-09-06T13:00:00Z")),
    30 * 60_000,
  );
});

test("a pause restored from the outbox stays stopped after browser reload", () => {
  const sessions = [start, pause].reduce(projectCommand, []);
  assert.equal(
    elapsedAt(sessions[0]!, Date.parse("2026-09-06T13:00:00Z")),
    15 * 60_000,
  );
});

test("an acknowledged command left in storage after interruption is not double applied", () => {
  const savedServerState = [start, pause].reduce(projectCommand, []);
  assert.deepEqual(
    [start, pause].reduce(projectCommand, savedServerState),
    savedServerState,
  );
});

test("outbox restores stable command IDs and rejects malformed transition data", () => {
  assert.equal(
    commandsSchema.parse([pause])[0]!.input.commandId,
    pause.input.commandId,
  );
  assert.equal(
    commandsSchema.safeParse([
      { ...pause, input: { ...pause.input, expectedRevision: -1 } },
    ]).success,
    false,
  );
  assert.equal(
    commandsSchema.safeParse([
      { ...pause, input: { ...pause.input, occurredAt: "yesterday" } },
    ]).success,
    false,
  );
});
