import { Module } from "@nestjs/common";
import { ApplePushNotificationClient } from "./apple-push-notification.client.js";
import { LiveActivityPushConfig } from "./live-activity-push.config.js";
import { LiveActivityPushService } from "./live-activity-push.service.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { RealtimeService } from "./realtime.service.js";
import { RealtimeLiveActivityRegistrationPipe } from "./realtime-live-activity-registration.pipe.js";
import { RealtimePingPipe } from "./realtime-ping.pipe.js";
import { RealtimeTimerCommandPipe } from "./realtime-timer-command.pipe.js";
import { RealtimeWsExceptionFilter } from "./realtime-ws-exception.filter.js";
import { TimerStateChangedListener } from "./timer-state-changed.listener.js";

@Module({
  providers: [
    ApplePushNotificationClient,
    LiveActivityPushConfig,
    LiveActivityPushService,
    RealtimeGateway,
    RealtimeLiveActivityRegistrationPipe,
    RealtimePingPipe,
    RealtimeService,
    RealtimeTimerCommandPipe,
    RealtimeWsExceptionFilter,
    TimerStateChangedListener,
  ],
})
export class RealtimeModule {}
