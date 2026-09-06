import { describe, expect, it, mock } from "bun:test";
import type { ApplicationEventBus } from "../src/events/application-event-bus.service.js";
import { RealtimeService } from "../src/realtime/realtime.service.js";
import { timerStateChangedEvent } from "../src/realtime/timer-state-changed.event.js";

function createSubject() {
  const publish = mock((_event: string, _payload: unknown) => undefined);
  const eventBus = { publish } as unknown as ApplicationEventBus;

  return { publish, service: new RealtimeService(eventBus) };
}

describe("RealtimeService events", () => {
  it("publishes the changed timer state after a transition", () => {
    const { publish, service } = createSubject();

    const state = service.applyTimerCommand({ action: "start" });

    expect(publish).toHaveBeenCalledWith(timerStateChangedEvent, {
      action: "start",
      state,
    });
  });

  it("does not publish when a command is a no-op", () => {
    const { publish, service } = createSubject();

    service.applyTimerCommand({ action: "pause" });

    expect(publish).not.toHaveBeenCalled();
  });
});
