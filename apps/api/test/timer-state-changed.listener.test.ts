import { describe, expect, it, mock } from "bun:test";
import { ApplicationEventBus } from "../src/events/application-event-bus.service.js";
import type { LiveActivityPushService } from "../src/realtime/live-activity-push.service.js";
import type { RealtimeGateway } from "../src/realtime/realtime.gateway.js";
import { timerStateChangedEvent } from "../src/realtime/timer-state-changed.event.js";
import { TimerStateChangedListener } from "../src/realtime/timer-state-changed.listener.js";

describe("TimerStateChangedListener", () => {
  it("projects changed state and unregisters during module teardown", async () => {
    const eventBus = new ApplicationEventBus();
    const broadcastTimerState = mock((_state: unknown) => undefined);
    const publish = mock((_state: unknown, _event: "update" | "end") =>
      Promise.resolve(),
    );
    const listener = new TimerStateChangedListener(
      eventBus,
      { broadcastTimerState } as unknown as RealtimeGateway,
      { publish } as unknown as LiveActivityPushService,
    );
    const state = {
      elapsedMs: 0,
      isRunning: false,
      revision: 1,
      updatedAt: "1970-01-01T00:00:00.000Z",
    };

    listener.onModuleInit();
    eventBus.publish(timerStateChangedEvent, { action: "reset", state });
    await Promise.resolve();

    expect(broadcastTimerState).toHaveBeenCalledWith(state);
    expect(publish).toHaveBeenCalledWith(state, "end");

    listener.onModuleDestroy();
    eventBus.publish(timerStateChangedEvent, { action: "start", state });

    expect(broadcastTimerState).toHaveBeenCalledTimes(1);
  });
});
