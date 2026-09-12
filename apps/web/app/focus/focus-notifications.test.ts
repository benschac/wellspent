import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subscribeToFocusChanges } from "./focus-notifications";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

function fixture() {
  let message: (event: { payload: unknown }) => void = () => {};
  let status: (value: string) => void = () => {};
  let resolveAuth: (id: string) => void = () => {};
  const auth = new Promise<{
    data: { session: { user: { id: string } } };
    error: null;
  }>((resolve) => {
    resolveAuth = (id) =>
      resolve({ data: { session: { user: { id } } }, error: null });
  });
  const calls = { channels: [] as unknown[][], changes: 0, removals: 0 };
  const channel = {
    on(_type: string, _filter: unknown, callback: typeof message) {
      message = callback;
      return channel;
    },
    subscribe(callback: typeof status) {
      status = callback;
      return channel;
    },
  };
  const client = {
    auth: { getSession: () => auth },
    channel(...args: unknown[]) {
      calls.channels.push(args);
      return channel;
    },
    async removeChannel() {
      calls.removals++;
      return "ok";
    },
  };
  const stop = subscribeToFocusChanges(
    client as unknown as SupabaseClient,
    userId,
    () => {
      calls.changes++;
    },
  );
  return {
    calls,
    stop,
    resolveAuth,
    message: (payload: unknown) => message({ payload }),
    status: (value: string) => status(value),
  };
}

test("focus joins privately, refreshes on reconnect, and validates hints", async () => {
  const f = fixture();
  f.resolveAuth(userId);
  await Promise.resolve();
  assert.deepEqual(f.calls.channels, [
    [`focus:${userId}`, { config: { private: true } }],
  ]);
  f.status("SUBSCRIBED");
  f.status("CHANNEL_ERROR");
  f.status("SUBSCRIBED");
  f.message({ version: 1, sessionId });
  f.message({ version: 2, sessionId });
  f.message({ version: 1, sessionId, text: "unexpected content" });
  f.message({ version: 1, sessionId: "invalid" });
  assert.equal(f.calls.changes, 3);
  f.stop();
  f.message({ version: 1, sessionId });
  f.status("SUBSCRIBED");
  assert.equal(f.calls.changes, 3);
  assert.equal(f.calls.removals, 1);
});

test("focus does not join when unmounted before auth resolves", async () => {
  const f = fixture();
  f.stop();
  f.resolveAuth(userId);
  await Promise.resolve();
  assert.equal(f.calls.channels.length, 0);
});

test("focus does not subscribe under another account", async () => {
  const f = fixture();
  f.resolveAuth(sessionId);
  await Promise.resolve();
  assert.equal(f.calls.channels.length, 0);
  f.stop();
});
