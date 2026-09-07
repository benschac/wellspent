import { describe, expect, it, mock } from "bun:test";
import { WsException } from "@nestjs/websockets";
import { realtimeTimerCommandAckSchema } from "@repo/api-contract";
import type { LiveActivityPushService } from "../src/realtime/live-activity-push.service.js";
import { RealtimeGateway } from "../src/realtime/realtime.gateway.js";
import type { RealtimeService } from "../src/realtime/realtime.service.js";
import { RealtimeTimerCommandPipe } from "../src/realtime/realtime-timer-command.pipe.js";

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

  it("returns a correlated acknowledgement of the committed state", async () => {
    const { gateway, state } = subject();
    const reply = await gateway.handleTimerCommand({
      action: "pause",
      commandId: "request-1",
    });
    expect(reply).toEqual({
      event: "timer.command.ack",
      data: { commandId: "request-1", state },
    });
    expect(realtimeTimerCommandAckSchema.safeParse(reply?.data).success).toBe(
      true,
    );
  });

  it("acknowledges no-op commands with their unchanged revision", async () => {
    const { gateway, state } = subject();
    const reply = await gateway.handleTimerCommand({
      action: "start",
      commandId: "already-running",
    });
    expect(reply?.data).toEqual({ commandId: "already-running", state });
  });

  it("does not acknowledge before persistence resolves", async () => {
    const { gateway, state, applyTimerCommand } = subject();
    let commit!: (value: typeof state) => void;
    applyTimerCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          commit = resolve;
        }),
    );
    let acknowledged = false;
    const reply = gateway
      .handleTimerCommand({
        action: "pause",
        commandId: "pending-write",
      })
      .then((result) => {
        acknowledged = true;
        return result;
      });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    commit(state);
    expect((await reply)?.data).toEqual({ commandId: "pending-write", state });
  });

  it("preserves the reply-free legacy command protocol", async () => {
    const { gateway } = subject();
    expect(
      await gateway.handleTimerCommand({ action: "pause" }),
    ).toBeUndefined();
  });

  it("correlates sanitized write errors without returning an acknowledgement", async () => {
    const { gateway, applyTimerCommand } = subject();
    applyTimerCommand.mockRejectedValueOnce(
      new Error("private database error"),
    );
    try {
      await gateway.handleTimerCommand({
        action: "start",
        commandId: "failed-write",
      });
      throw new Error("Expected command failure");
    } catch (error) {
      expect(error).toBeInstanceOf(WsException);
      expect((error as WsException).getError()).toEqual({
        code: "TIMER_UNAVAILABLE",
        message: "Timer state could not be saved. Reconnect and try again.",
        commandId: "failed-write",
      });
    }
  });

  it("validates optional bounded command IDs at the real message boundary", () => {
    const pipe = new RealtimeTimerCommandPipe();
    expect(pipe.transform({ action: "start" })).toEqual({ action: "start" });
    const command = { action: "pause", commandId: "a".repeat(128) };
    expect(pipe.transform(command)).toEqual(command);
    for (const commandId of ["", "a".repeat(129), null, 42]) {
      expect(() => pipe.transform({ action: "start", commandId })).toThrow(
        WsException,
      );
    }
    expect(() => pipe.transform({ action: "start", unknown: true })).toThrow(
      WsException,
    );
  });
});
