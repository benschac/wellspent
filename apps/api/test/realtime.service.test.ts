import { describe, expect, it, mock } from "bun:test";
import type { ApplicationEventBus } from "../src/events/application-event-bus.service.js";
import { RealtimeService } from "../src/realtime/realtime.service.js";
import type { RealtimeTimerRepository } from "../src/realtime/realtime-timer.repository.js";
import { transitionRealtimeTimer } from "../src/realtime/realtime-timer-state.js";
import { timerStateChangedEvent } from "../src/realtime/timer-state-changed.event.js";

function createSubject() {
  const publish = mock((_event: string, _payload: unknown) => undefined);
  const eventBus = { publish } as unknown as ApplicationEventBus;

  const initial = {
    elapsedMs: 1234,
    isRunning: false,
    revision: 8,
    updatedAt: "2026-09-06T12:00:00.000Z",
  };
  const get = mock(async () => initial);
  const apply = mock(async () => ({ state: initial, changed: false }));
  const repository = { get, apply } as unknown as RealtimeTimerRepository;
  return {
    publish,
    get,
    apply,
    initial,
    service: new RealtimeService(eventBus, repository),
  };
}

describe("RealtimeService events", () => {
  it("publishes only after the database confirms the committed transition", async () => {
    const { publish, apply, initial, service } = createSubject();
    const state = { ...initial, isRunning: true, revision: 9 };
    const commit = Promise.withResolvers<{
      state: typeof state;
      changed: boolean;
    }>();
    apply.mockImplementation(() => commit.promise);
    const pending = service.applyTimerCommand({ action: "start" });
    expect(publish).not.toHaveBeenCalled();
    commit.resolve({ state, changed: true });
    expect(await pending).toEqual(state);

    expect(publish).toHaveBeenCalledWith(timerStateChangedEvent, {
      action: "start",
      state,
    });
  });

  it("does not publish when a command is a no-op", async () => {
    const { publish, service } = createSubject();

    await service.applyTimerCommand({ action: "pause" });

    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish or hide a failed commit", async () => {
    const { publish, apply, service } = createSubject();
    apply.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      service.applyTimerCommand({ action: "reset" }),
    ).rejects.toThrow("database unavailable");
    expect(publish).not.toHaveBeenCalled();
  });

  it("reads the stored revision and timestamp without resetting them", async () => {
    const { get, initial, service } = createSubject();
    expect(await service.getTimerState()).toEqual(initial);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("shared timer transition compatibility", () => {
  const running = {
    elapsedMs: 5000,
    isRunning: true,
    revision: 7,
    updatedAt: "2026-09-06T12:00:00.000Z",
  };
  const now = Date.parse("2026-09-06T12:10:00.000Z");

  it("counts API downtime when pausing a stored running timer", () => {
    expect(transitionRealtimeTimer(running, { action: "pause" }, now)).toEqual({
      elapsedMs: 605000,
      isRunning: false,
      revision: 8,
      updatedAt: new Date(now).toISOString(),
    });
  });

  it("does not accrue paused downtime when resuming", () => {
    expect(
      transitionRealtimeTimer(
        { ...running, isRunning: false },
        { action: "start" },
        now,
      ),
    ).toEqual({
      ...running,
      revision: 8,
      updatedAt: new Date(now).toISOString(),
    });
  });

  it("preserves milliseconds across a daylight-saving offset change", () => {
    expect(
      transitionRealtimeTimer(
        { ...running, updatedAt: "2026-11-01T01:59:59.875-04:00" },
        { action: "pause" },
        Date.parse("2026-11-01T01:00:00.125-05:00"),
      ),
    ).toEqual({
      elapsedMs: 5250,
      isRunning: false,
      revision: 8,
      updatedAt: "2026-11-01T06:00:00.125Z",
    });
  });

  it("does not subtract elapsed time when the wall clock moves backward", () => {
    expect(
      transitionRealtimeTimer(
        running,
        { action: "pause" },
        Date.parse("2026-09-06T11:59:59.500Z"),
      ),
    ).toEqual({
      elapsedMs: 5000,
      isRunning: false,
      revision: 8,
      updatedAt: "2026-09-06T11:59:59.500Z",
    });
  });

  it("preserves running status on reset and advances its clock anchor", () => {
    for (const isRunning of [true, false]) {
      expect(
        transitionRealtimeTimer(
          { ...running, isRunning },
          { action: "reset" },
          now,
        ),
      ).toEqual({
        elapsedMs: 0,
        isRunning,
        revision: 8,
        updatedAt: new Date(now).toISOString(),
      });
    }
  });

  it("keeps repeated start/pause commands as no-ops", () => {
    expect(transitionRealtimeTimer(running, { action: "start" }, now)).toEqual(
      running,
    );
    const paused = { ...running, isRunning: false };
    expect(transitionRealtimeTimer(paused, { action: "pause" }, now)).toEqual(
      paused,
    );
  });
});
