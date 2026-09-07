import { afterEach, describe, expect, it } from "bun:test";
import { safeTimerEndpoint, TimerSyncTracker } from "../src/timer-sync";
import { decodeTimerSyncMessage } from "../src/timer-sync-message";

function handleTimerSyncMessage(tracker: TimerSyncTracker, data: unknown) {
  return tracker.receive(decodeTimerSyncMessage(data));
}

const trackers: TimerSyncTracker[] = [];
afterEach(() => {
  for (const tracker of trackers.splice(0)) tracker.dispose();
});
function subject(
  timeout = 1000,
  url: string | undefined = "ws://localhost:3001/api/ws",
) {
  const tracker = new TimerSyncTracker(url, () => {}, timeout);
  trackers.push(tracker);
  return tracker;
}
const state = {
  elapsedMs: 0,
  isRunning: true,
  revision: 14,
  updatedAt: "2026-09-07T01:19:56.843Z",
};
const snapshot = JSON.stringify({ event: "timer.state", data: state });
const ack = (commandId: string) =>
  JSON.stringify({ event: "timer.command.ack", data: { commandId, state } });

describe("timer sync confirmation", () => {
  it("waits for a valid snapshot, not just an open socket", () => {
    const tracker = subject();
    expect(tracker.state.status).toBe("connecting");
    tracker.connectionChanged("open");
    expect(tracker.state.status).toBe("connecting");
    expect(handleTimerSyncMessage(tracker, snapshot)).toEqual(state);
    expect(tracker.state.status).toBe("connected");
    expect(tracker.state.lastConfirmedRevision).toBe(14);
  });

  it("does not confirm local actions from a broadcast or another client's ack", () => {
    const tracker = subject();
    tracker.queued("own");
    tracker.sent("own");
    handleTimerSyncMessage(tracker, snapshot);
    expect(handleTimerSyncMessage(tracker, ack("other"))).toBeNull();
    expect(tracker.state.pendingCount).toBe(1);
    expect(tracker.state.message).toContain("pending server confirmation");
    expect(handleTimerSyncMessage(tracker, ack("own"))).toEqual(state);
    expect(tracker.state.pendingCount).toBe(0);
  });

  it("accepts same-revision no-op acknowledgements, once", () => {
    const tracker = subject();
    handleTimerSyncMessage(tracker, snapshot);
    tracker.queued("noop");
    tracker.sent("noop");
    expect(handleTimerSyncMessage(tracker, ack("noop"))).toEqual(state);
    expect(handleTimerSyncMessage(tracker, ack("noop"))).toBeNull();
    expect(tracker.state.lastConfirmedRevision).toBe(14);
    expect(tracker.state.pendingCount).toBe(0);
  });

  it("never confirms an unsent command", () => {
    const tracker = subject();
    tracker.queued("queued");
    expect(handleTimerSyncMessage(tracker, ack("queued"))).toBeNull();
    expect(tracker.state.pendingCount).toBe(1);
  });

  it("keeps offline queued changes pending through reconnect snapshots", () => {
    const tracker = subject();
    tracker.connectionChanged("offline");
    tracker.queued("offline");
    expect(tracker.state.status).toBe("offline");
    expect(tracker.state.message).toContain("queue is not durable");
    tracker.connectionChanged("open");
    handleTimerSyncMessage(tracker, snapshot);
    expect(tracker.state.pendingCount).toBe(1);
    tracker.sent("offline");
    handleTimerSyncMessage(tracker, ack("offline"));
    expect(tracker.state.pendingCount).toBe(0);
  });

  it("keeps lost acknowledgements unconfirmed after a reconnect snapshot", () => {
    const tracker = subject();
    tracker.queued("lost");
    tracker.sent("lost");
    tracker.connectionChanged("offline");
    expect(tracker.state.status).toBe("offline");
    tracker.connectionChanged("open");
    handleTimerSyncMessage(tracker, snapshot);
    expect(tracker.state.status).toBe("error");
    expect(tracker.state.pendingCount).toBe(1);
    expect(tracker.state.message).toContain("not automatically retried");
  });

  it("does not clear a rejected command when another action succeeds", () => {
    const tracker = subject();
    for (const id of ["failed", "saved"]) {
      tracker.queued(id);
      tracker.sent(id);
    }
    handleTimerSyncMessage(
      tracker,
      JSON.stringify({
        event: "exception",
        data: { commandId: "failed", message: "secret database URL" },
      }),
    );
    handleTimerSyncMessage(tracker, ack("saved"));
    expect(tracker.state.status).toBe("error");
    expect(tracker.state.pendingCount).toBe(1);
    expect(tracker.state.message).not.toContain("secret");
  });

  it("flags malformed frames without publishing state", () => {
    const tracker = subject();
    for (const frame of [
      "not json",
      "null",
      snapshot.replace('"revision":14', '"revision":-1'),
      JSON.stringify({ event: "timer.command.ack", data: { commandId: "x" } }),
    ]) {
      expect(handleTimerSyncMessage(tracker, frame)).toBeNull();
      expect(tracker.state.status).toBe("error");
    }
    expect(tracker.state.lastConfirmedRevision).toBeNull();
    handleTimerSyncMessage(tracker, snapshot);
    expect(tracker.state.status).toBe("connected");
  });

  it("flags storage failure close separately from ordinary offline", () => {
    const tracker = subject();
    tracker.connectionChanged("error");
    expect(tracker.state.status).toBe("error");
    expect(tracker.state.message).toContain("Saved state is unavailable");
    tracker.connectionChanged("open");
    handleTimerSyncMessage(tracker, snapshot);
    expect(tracker.state.status).toBe("connected");
  });

  it("times out missing initial state and missing own acknowledgement", async () => {
    const tracker = subject(5);
    tracker.connectionChanged("open");
    await Bun.sleep(15);
    expect(tracker.state.status).toBe("error");
    expect(tracker.state.message).toContain("no valid timer snapshot");
    handleTimerSyncMessage(tracker, snapshot);
    tracker.queued("late");
    tracker.sent("late");
    await Bun.sleep(15);
    expect(tracker.state.status).toBe("error");
    handleTimerSyncMessage(tracker, ack("late"));
    expect(tracker.state.status).toBe("connected");
  });

  it("does not rewind the last confirmed revision", () => {
    const tracker = subject();
    tracker.receivedState(14);
    tracker.receivedState(12);
    expect(tracker.state.lastConfirmedRevision).toBe(14);
  });

  it("isolates endpoint lifetimes and cancels disposed timers", async () => {
    let changes = 0;
    const tracker = new TimerSyncTracker(
      "ws://first/api/ws",
      () => changes++,
      5,
    );
    tracker.connectionChanged("open");
    tracker.queued("old");
    tracker.sent("old");
    tracker.dispose();
    const before = changes;
    await Bun.sleep(15);
    expect(changes).toBe(before);
    const next = subject(1000, "ws://second/api/ws");
    expect(next.acknowledged("old", 100)).toBe(false);
    expect(next.state.lastConfirmedRevision).toBeNull();
  });

  it("redacts endpoint credentials and marks missing/invalid configuration", () => {
    expect(
      safeTimerEndpoint(
        "wss://user:secret@api.example/api/ws?token=private#private",
      ),
    ).toBe("wss://api.example/api/ws");
    expect(safeTimerEndpoint("not a URL with secrets")).toBe(
      "Invalid endpoint",
    );
    expect(safeTimerEndpoint("data:text/plain,secret")).toBe(
      "Invalid endpoint",
    );
    expect(safeTimerEndpoint(undefined)).toBe("Not configured");
    const tracker = new TimerSyncTracker(undefined, () => {});
    expect(tracker.state.status).toBe("offline");
    expect(tracker.state.message).toContain("Local timer only");
    tracker.dispose();
  });
});

describe("timer sync decoding", () => {
  it("decodes snapshots and acknowledgements without a tracker", () => {
    expect(decodeTimerSyncMessage(snapshot)).toEqual({ type: "state", state });
    expect(decodeTimerSyncMessage(ack("own"))).toEqual({
      type: "acknowledgement",
      commandId: "own",
      state,
    });
  });

  it("distinguishes malformed frames from unrelated events", () => {
    for (const frame of [
      undefined,
      {},
      "null",
      "[]",
      "42",
      "not json",
      JSON.stringify({ event: 42 }),
      JSON.stringify({ event: "timer.state", data: {} }),
      JSON.stringify({ event: "timer.command.ack", data: {} }),
    ]) {
      expect(decodeTimerSyncMessage(frame)).toEqual({ type: "invalid" });
    }
    expect(decodeTimerSyncMessage(JSON.stringify({ event: "other" }))).toEqual({
      type: "ignored",
    });
  });

  it("keeps only valid correlation IDs from server errors", () => {
    for (const payload of [null, "secret", {}, { commandId: 42 }]) {
      expect(
        decodeTimerSyncMessage(
          JSON.stringify({ event: "exception", data: payload }),
        ),
      ).toEqual({ type: "rejection", commandId: undefined });
    }
    expect(
      decodeTimerSyncMessage(
        JSON.stringify({
          event: "exception",
          data: { commandId: "own", message: "secret database URL" },
        }),
      ),
    ).toEqual({ type: "rejection", commandId: "own" });
  });

  it("does not classify subscriber failures as malformed server data", () => {
    const tracker = new TimerSyncTracker("ws://localhost/api/ws", () => {
      throw new Error("Subscriber failed");
    });
    trackers.push(tracker);
    expect(() => handleTimerSyncMessage(tracker, snapshot)).toThrow(
      "Subscriber failed",
    );
    expect(tracker.state.status).toBe("connected");
    expect(tracker.state.message).toContain("Server-confirmed");
  });

  it("ignores unrelated events without changing or publishing sync state", () => {
    let changes = 0;
    const tracker = new TimerSyncTracker(
      "ws://localhost/api/ws",
      () => changes++,
    );
    trackers.push(tracker);
    const before = tracker.state;
    expect(
      handleTimerSyncMessage(tracker, JSON.stringify({ event: "other" })),
    ).toBeNull();
    expect(tracker.state).toEqual(before);
    expect(changes).toBe(0);
  });
});
