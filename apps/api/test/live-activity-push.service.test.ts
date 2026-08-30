import { describe, expect, it, mock } from "bun:test";
import type {
  ApplePushNotificationClient,
  LiveActivityPushPayload,
} from "../src/realtime/apple-push-notification.client.js";
import type { LiveActivityPushConfig } from "../src/realtime/live-activity-push.config.js";
import { LiveActivityPushService } from "../src/realtime/live-activity-push.service.js";

function createSubject() {
  const sendLiveActivityPush = mock(
    (_pushToken: string, _payload: LiveActivityPushPayload) =>
      Promise.resolve({ statusCode: 200 }),
  );
  const client = {
    sendLiveActivityPush,
  } as unknown as ApplePushNotificationClient;
  const config = { enabled: true } as LiveActivityPushConfig;
  const service = new LiveActivityPushService(client, config);

  service.register({
    activityId: "activity-1",
    pushToken: "aabbccdd",
    realtimeUrl: "wss://timer.example.com/api/ws",
  });

  return { sendLiveActivityPush, service };
}

describe("LiveActivityPushService", () => {
  it("sends ActivityKit content using the authoritative timer origin", async () => {
    const { sendLiveActivityPush, service } = createSubject();

    await service.publish(
      {
        elapsedMs: 2_500,
        isRunning: true,
        revision: 1,
        updatedAt: "1970-01-01T00:00:10.000Z",
      },
      "update",
    );

    expect(sendLiveActivityPush).toHaveBeenCalledTimes(1);
    expect(sendLiveActivityPush.mock.calls[0]?.[0]).toBe("aabbccdd");
    expect(sendLiveActivityPush.mock.calls[0]?.[1].aps).toMatchObject({
      "content-state": {
        elapsedMs: 2_500,
        isRunning: true,
        originEpochMs: 7_500,
        realtimeUrl: "wss://timer.example.com/api/ws",
      },
      event: "update",
    });
  });

  it("does not push the same timer revision twice", async () => {
    const { sendLiveActivityPush, service } = createSubject();
    const state = {
      elapsedMs: 0,
      isRunning: true,
      revision: 1,
      updatedAt: "1970-01-01T00:00:10.000Z",
    };

    await service.publish(state, "update");
    await service.publish(state, "update");

    expect(sendLiveActivityPush).toHaveBeenCalledTimes(1);
  });

  it("ends and immediately dismisses a reset paused activity", async () => {
    const { sendLiveActivityPush, service } = createSubject();

    await service.publish(
      {
        elapsedMs: 0,
        isRunning: false,
        revision: 2,
        updatedAt: "1970-01-01T00:00:20.000Z",
      },
      "end",
    );

    const aps = sendLiveActivityPush.mock.calls[0]?.[1].aps;
    expect(aps?.event).toBe("end");
    expect(aps?.["dismissal-date"]).toBeLessThan(aps?.timestamp ?? 0);
  });
});
