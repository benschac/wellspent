import assert from "node:assert/strict";
import { test } from "node:test";
import { finish, pause, resume, start } from "@repo/session-domain/testing";
import { commandsSchema, elapsedAt, projectCommand } from "./focus-state";

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
  const [session] = [start, pause].reduce(projectCommand, []);
  assert.ok(session);
  assert.equal(
    elapsedAt(session, Date.parse("2026-09-06T13:00:00Z")),
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
  const [restored] = commandsSchema.parse([pause]);
  assert.ok(restored);
  assert.equal(restored.input.commandId, pause.input.commandId);
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
