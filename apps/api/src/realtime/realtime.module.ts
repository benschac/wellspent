import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { ApplePushNotificationClient } from "./apple-push-notification.client.js";
import { LiveActivityPushConfig } from "./live-activity-push.config.js";
import { LiveActivityPushService } from "./live-activity-push.service.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import { RealtimeService } from "./realtime.service.js";
import { RealtimeLiveActivityRegistrationPipe } from "./realtime-live-activity-registration.pipe.js";
import { RealtimePingPipe } from "./realtime-ping.pipe.js";
import { RealtimeTimerRepository } from "./realtime-timer.repository.js";
import { RealtimeTimerCommandPipe } from "./realtime-timer-command.pipe.js";
import { RealtimeWsExceptionFilter } from "./realtime-ws-exception.filter.js";
import { TimerStateChangedListener } from "./timer-state-changed.listener.js";

@Module({
  imports: [DatabaseModule],
  providers: [
    ApplePushNotificationClient,
    LiveActivityPushConfig,
    LiveActivityPushService,
    RealtimeGateway,
    RealtimeLiveActivityRegistrationPipe,
    RealtimePingPipe,
    RealtimeService,
    RealtimeTimerCommandPipe,
    RealtimeTimerRepository,
    RealtimeWsExceptionFilter,
    TimerStateChangedListener,
  ],
})
export class RealtimeModule {}
