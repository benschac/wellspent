import { describe, expect, it, mock } from "bun:test";
import { WsException } from "@nestjs/websockets";
import type { LiveActivityPushService } from "../src/realtime/live-activity-push.service.js";
import { RealtimeGateway } from "../src/realtime/realtime.gateway.js";
import type { RealtimeService } from "../src/realtime/realtime.service.js";

describe("persisted timer gateway", () => {
  function subject() {
    const state = {
      elapsedMs: 9000,
      isRunning: true,
      revision: 12,
      updatedAt: "2026-09-06T12:00:00.000Z",
    };
    const getTimerState = mock(async () => state);
    const applyTimerCommand = mock(async () => state);
    const gateway = new RealtimeGateway(
      { getTimerState, applyTimerCommand } as unknown as RealtimeService,
      {} as LiveActivityPushService,
    );
    const client = {
      readyState: 1,
      send: mock((_data: string) => undefined),
      close: mock((_code: number, _reason: string) => undefined),
    };
    return { state, getTimerState, applyTimerCommand, gateway, client };
  }

  it("sends the stored state on reconnect using the existing envelope", async () => {
    const { state, gateway, client } = subject();
    await gateway.handleConnection(client);
    expect(JSON.parse(client.send.mock.calls[0]?.[0] ?? "null")).toEqual({
      event: "timer.state",
      data: state,
    });
  });

  it("closes on storage failure without publishing an empty timer", async () => {
    const { getTimerState, gateway, client } = subject();
    getTimerState.mockRejectedValueOnce(new Error("storage failed"));
    await gateway.handleConnection(client);
    expect(client.send).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledWith(
      1011,
      "Timer storage unavailable",
    );
  });

  it("does not send a delayed snapshot to an already closed client", async () => {
    const { gateway, client } = subject();
    client.readyState = 3;
    await gateway.handleConnection(client);
    expect(client.send).not.toHaveBeenCalled();
  });

  it("maps failed writes into a safe WebSocket error", async () => {
    const { applyTimerCommand, gateway } = subject();
    applyTimerCommand.mockRejectedValueOnce(
      new Error("private database error"),
    );
    try {
      await gateway.handleTimerCommand({ action: "start" });
      throw new Error("Expected command failure");
    } catch (error) {
      expect(error).toBeInstanceOf(WsException);
      expect((error as WsException).getError()).toEqual({
        code: "TIMER_UNAVAILABLE",
        message: "Timer state could not be saved. Reconnect and try again.",
      });
    }
  });
});
