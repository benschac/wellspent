import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Stopwatch } from "@repo/timer";
import { renderToStaticMarkup } from "react-dom/server";
import { TimerSyncStatus } from "./timer-sync-status";

const confirmed: Stopwatch["sync"] = {
  status: "connected",
  pendingCount: 0,
  lastConfirmedRevision: 14,
  endpoint: "ws://localhost:3001/api/ws",
  message: "Timer confirmed by server.",
};

describe("timer sync status", () => {
  for (const [status, label] of [
    ["connecting", "Connecting"],
    ["connected", "Connected"],
    ["offline", "Offline"],
    ["error", "Sync error"],
  ] as const) {
    test(`shows ${status} without opening diagnostics`, () => {
      const html = renderToStaticMarkup(
        <TimerSyncStatus sync={{ ...confirmed, status }} />,
      );
      const visibleStatus = html.slice(0, html.indexOf("<details"));
      assert.ok(visibleStatus.includes(label));
      assert.ok(visibleStatus.includes('role="status"'));
      assert.ok(visibleStatus.includes('aria-live="polite"'));
    });
  }

  test("shows unconfirmed action explanation and diagnostic evidence", () => {
    const html = renderToStaticMarkup(
      <TimerSyncStatus
        sync={{
          ...confirmed,
          pendingCount: 2,
          message: "Waiting for server confirmation.",
        }}
      />,
    );
    assert.ok(html.includes("Waiting for server confirmation."));
    assert.ok(html.includes("ws://localhost:3001/api/ws"));
    assert.ok(html.includes("<dt>Unconfirmed actions</dt><dd>2</dd>"));
    assert.ok(html.includes("<dt>Last confirmed revision</dt><dd>14</dd>"));
  });

  test("does not present an unconfirmed initial state as saved revision zero", () => {
    const html = renderToStaticMarkup(
      <TimerSyncStatus
        sync={{ ...confirmed, endpoint: "", lastConfirmedRevision: null }}
      />,
    );
    assert.ok(html.includes("Not configured"));
    assert.ok(
      html.includes("<dt>Last confirmed revision</dt><dd>None yet</dd>"),
    );
  });
});
