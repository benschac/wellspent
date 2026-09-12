import assert from "node:assert/strict";
import { test } from "node:test";
import { createFocusOutbox } from "./focus-outbox";
import {
  createFocusSessionSync,
  initialFocusSessionsState,
} from "./focus-session-sync";
import {
  type FocusCommand,
  type FocusSession,
  projectCommand,
} from "./focus-state";

function fixture() {
  const values = new Map<string, string>();
  const store = createFocusOutbox(
    {
      get length() {
        return values.size;
      },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    },
    "account-a",
  );
  const command: FocusCommand = {
    type: "create",
    input: {
      id: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      intention: "Recover pending work",
      occurredAt: "2026-09-07T12:00:00.000Z",
    },
  };
  const [session] = projectCommand([], command);
  assert.ok(session);
  const abort = new AbortController();
  let state = initialFocusSessionsState();
  const options = {
    userId: "account-a",
    store,
    signal: abort.signal,
    publish: (patch: Partial<typeof state>) => {
      state = { ...state, ...patch };
    },
  };
  const focus = {
    list: async () => [session],
    create: async () => session,
    transition: async () => session,
  };
  return { store, command, session, abort, options, focus, state: () => state };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise not initialized");
  };
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("replay persists the baseline and only acknowledges successful commands", async () => {
  const f = fixture();
  f.store.add(f.command);
  const controller = createFocusSessionSync({
    ...f.options,
    api: { focus: f.focus },
  });
  controller.display();
  assert.equal(f.state().pending.length, 1);
  await controller.sync();
  assert.deepEqual(f.store.readCommands(), []);
  assert.deepEqual(f.store.readSessions(), [f.session]);
  assert.equal(f.state().pending.length, 0);
});

test("a hint during a request triggers one additional refresh", async () => {
  const f = fixture();
  const response = deferred<FocusSession[]>();
  let reads = 0;
  const controller = createFocusSessionSync({
    ...f.options,
    api: {
      focus: {
        ...f.focus,
        list: async () => {
          reads++;
          return reads === 1 ? response.promise : [f.session];
        },
      },
    },
  });
  const syncing = controller.sync();
  await controller.sync();
  await controller.sync();
  response.resolve([f.session]);
  await syncing;
  assert.equal(reads, 2);
});

test("aborted replay cannot acknowledge work or publish into the next lifetime", async () => {
  const f = fixture();
  f.store.add(f.command);
  const response = deferred<FocusSession>();
  const controller = createFocusSessionSync({
    ...f.options,
    api: { focus: { ...f.focus, create: async () => response.promise } },
  });
  const syncing = controller.sync();
  f.abort.abort();
  response.resolve(f.session);
  await syncing;
  assert.deepEqual(f.store.readCommands(), [f.command]);
  assert.deepEqual(f.store.readSessions(), []);
  assert.deepEqual(f.state(), initialFocusSessionsState());
  assert.equal(controller.enqueue(f.command), false);
  const restarted = createFocusSessionSync({
    ...f.options,
    signal: new AbortController().signal,
    api: { focus: f.focus },
  });
  await restarted.sync();
  assert.deepEqual(f.store.readCommands(), []);
});

test("authorization failure retains actions and allows retry; conflicts block new actions", async () => {
  for (const status of [401, 409]) {
    const f = fixture();
    f.store.add(f.command);
    let attempts = 0;
    const controller = createFocusSessionSync({
      ...f.options,
      api: {
        focus: {
          ...f.focus,
          create: async () => {
            attempts++;
            throw { status };
          },
        },
      },
    });
    await controller.sync();
    assert.deepEqual(f.store.readCommands(), [f.command]);
    assert.equal(f.state().blocked, status === 409);
    assert.ok(f.state().error);
    await controller.sync();
    assert.equal(attempts, status === 401 ? 2 : 1);
    if (status === 409) assert.equal(controller.enqueue(f.command), false);
  }
});

test("discard is aborted without removing pending actions", async () => {
  const f = fixture();
  f.store.add(f.command);
  const response = deferred<FocusSession[]>();
  const controller = createFocusSessionSync({
    ...f.options,
    api: {
      focus: {
        ...f.focus,
        list: async (_input, options) => {
          assert.equal(options?.signal, f.abort.signal);
          return response.promise;
        },
      },
    },
  });
  const discarding = controller.discardPending();
  f.abort.abort();
  response.resolve([f.session]);
  await discarding;
  assert.deepEqual(f.store.readCommands(), [f.command]);
  assert.deepEqual(f.store.readSessions(), []);
});

test("discard preserves another tab's command added while fetching the server state", async () => {
  const f = fixture();
  f.store.add(f.command);
  const response = deferred<FocusSession[]>();
  const controller = createFocusSessionSync({
    ...f.options,
    api: { focus: { ...f.focus, list: async () => response.promise } },
  });
  const discarding = controller.discardPending();
  const other: FocusCommand = {
    type: "create",
    input: { ...f.command.input, commandId: crypto.randomUUID() },
  };
  f.store.add(other);
  response.resolve([f.session]);
  await discarding;
  assert.deepEqual(f.store.readCommands(), [other]);
});
