import { describe, expect, it, mock } from "bun:test";
import { ApplicationEventBus } from "../src/events/application-event-bus.service.js";

describe("ApplicationEventBus", () => {
  it("publishes payloads and returns an unsubscribe function", () => {
    const bus = new ApplicationEventBus();
    const listener = mock((_payload: { revision: number }) => undefined);
    const unsubscribe = bus.subscribe("timer.changed", listener);

    bus.publish("timer.changed", { revision: 1 });
    unsubscribe();
    bus.publish("timer.changed", { revision: 2 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ revision: 1 });
  });
});
