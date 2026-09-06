import assert from "node:assert/strict";
import { test } from "node:test";
import { createFocusOutbox } from "./focus-outbox";
import { projectCommand, type FocusCommand } from "./focus-state";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
function start(id = crypto.randomUUID()): FocusCommand {
  return {
    type: "create",
    input: {
      id: crypto.randomUUID(),
      commandId: id,
      intention: "Browser recovery",
      occurredAt: "2026-09-05T12:00:00.000Z",
    },
  };
}

test("a new browser instance restores pending work without a sessionStorage tab ID", () => {
  const storage = memoryStorage();
  const firstBrowser = createFocusOutbox(storage, "account-a");
  const command = start();
  firstBrowser.add(command);
  assert.deepEqual(createFocusOutbox(storage, "account-a").readCommands(), [
    command,
  ]);
  assert.deepEqual(createFocusOutbox(storage, "account-b").readCommands(), []);
});

test("fresh server baselines survive an offline reopen even with no queued commands", () => {
  const storage = memoryStorage();
  const store = createFocusOutbox(storage, "account-a");
  const session = projectCommand([], start())[0]!;
  store.saveSessions([session]);
  const resumed = createFocusOutbox(storage, "account-a");
  assert.deepEqual(resumed.readSessions(), [session]);
  assert.equal(resumed.readCommands().length, 0);
});

test("one tab acknowledging its action cannot remove another tab's new action", () => {
  const storage = memoryStorage();
  const first = createFocusOutbox(storage, "account-a");
  const second = createFocusOutbox(storage, "account-a");
  const a = start();
  const b = start();
  first.add(a);
  second.add(b);
  first.acknowledge(a.input.commandId);
  assert.deepEqual(second.readCommands(), [b]);
});

test("a delayed server response preserves the latest timer and recap revisions", () => {
  const store = createFocusOutbox(memoryStorage(), "account-a");
  const session = projectCommand([], start())[0]!;
  store.saveSessions([
    { ...session, revision: 4, recapRevision: 2, recapText: "Latest recap" },
  ]);
  store.saveSessions([session]);
  assert.equal(store.readSessions()[0]!.revision, 4);
  assert.equal(store.readSessions()[0]!.recapText, "Latest recap");
});

test("a full outbox rejects more actions without losing the existing 1,000", () => {
  const store = createFocusOutbox(memoryStorage(), "account-a");
  for (let i = 0; i < 1000; i++) store.add(start());
  assert.throws(() => store.add(start()), /1,000 timer actions/);
  assert.equal(store.readCommands().length, 1000);
});
