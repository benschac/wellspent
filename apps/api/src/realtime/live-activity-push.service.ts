import { Injectable, Logger } from "@nestjs/common";
import type {
  RealtimeTimerLiveActivityRegistration,
  RealtimeTimerState,
} from "@repo/api-contract";
import {
  ApplePushNotificationClient,
  type LiveActivityPushPayload,
} from "./apple-push-notification.client.js";
import { LiveActivityPushConfig } from "./live-activity-push.config.js";

const maxRegistrations = 1_000;

@Injectable()
export class LiveActivityPushService {
  private readonly logger = new Logger(LiveActivityPushService.name);
  private readonly registrations = new Map<
    string,
    RealtimeTimerLiveActivityRegistration
  >();
  private lastPublishedRevision = -1;

  constructor(
    private readonly client: ApplePushNotificationClient,
    private readonly config: LiveActivityPushConfig,
  ) {}

  register(registration: RealtimeTimerLiveActivityRegistration): void {
    if (!this.config.enabled) {
      return;
    }

    if (
      !this.registrations.has(registration.activityId) &&
      this.registrations.size >= maxRegistrations
    ) {
      this.logger.warn("Live Activity registration limit reached");
      return;
    }

    this.registrations.set(registration.activityId, registration);
  }

  async publish(
    state: RealtimeTimerState,
    event: "end" | "update",
  ): Promise<void> {
    if (
      !this.config.enabled ||
      state.revision <= this.lastPublishedRevision ||
      this.registrations.size === 0
    ) {
      return;
    }

    this.lastPublishedRevision = state.revision;
    const registrations = [...this.registrations.values()];

    await Promise.all(
      registrations.map(async (registration) => {
        const payload = this.createPayload(state, event, registration.realtimeUrl);

        try {
          const response = await this.client.sendLiveActivityPush(
            registration.pushToken,
            payload,
          );

          if (response.statusCode === 200) {
            return;
          }

          if (
            response.statusCode === 410 ||
            response.reason === "BadDeviceToken" ||
            response.reason === "DeviceTokenNotForTopic"
          ) {
            this.registrations.delete(registration.activityId);
          }

          this.logger.warn(
            `APNs rejected a Live Activity update (${response.statusCode}${
              response.reason ? `: ${response.reason}` : ""
            })`,
          );
        } catch (error) {
          this.logger.error("Failed to send a Live Activity update", error);
        }
      }),
    );

    if (event === "end") {
      this.registrations.clear();
    }
  }

  private createPayload(
    state: RealtimeTimerState,
    event: "end" | "update",
    realtimeUrl: string,
  ): LiveActivityPushPayload {
    const updatedAtMs = Date.parse(state.updatedAt);
    const timestamp = Math.floor(Date.now() / 1_000);
    const aps: LiveActivityPushPayload["aps"] = {
      "content-state": {
        elapsedMs: state.elapsedMs,
        isRunning: state.isRunning,
        originEpochMs: Math.max(0, updatedAtMs - state.elapsedMs),
        realtimeUrl,
      },
      event,
      timestamp,
    };

    if (event === "end") {
      aps["dismissal-date"] = timestamp - 1;
    }

    return { aps };
  }
}
