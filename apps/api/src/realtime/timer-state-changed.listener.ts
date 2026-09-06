import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ApplicationEventBus } from "../events/application-event-bus.service.js";
import { LiveActivityPushService } from "./live-activity-push.service.js";
import { RealtimeGateway } from "./realtime.gateway.js";
import {
  type TimerStateChangedEvent,
  timerStateChangedEvent,
} from "./timer-state-changed.event.js";

@Injectable()
export class TimerStateChangedListener
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TimerStateChangedListener.name);
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly eventBus: ApplicationEventBus,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly liveActivityPushService: LiveActivityPushService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.eventBus.subscribe<TimerStateChangedEvent>(
      timerStateChangedEvent,
      this.handleTimerStateChanged,
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private readonly handleTimerStateChanged = (
    event: TimerStateChangedEvent,
  ): void => {
    this.realtimeGateway.broadcastTimerState(event.state);

    void this.liveActivityPushService
      .publish(
        event.state,
        event.action === "reset" && !event.state.isRunning ? "end" : "update",
      )
      .catch((error: unknown) => {
        this.logger.error("Failed to publish Live Activity timer state", error);
      });
  };
}
