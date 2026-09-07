import { Inject, Injectable } from "@nestjs/common";
import type {
  RealtimePing,
  RealtimePong,
  RealtimeTimerCommand,
  RealtimeTimerState,
} from "@repo/api-contract";
import { ApplicationEventBus } from "../events/application-event-bus.service.js";
import { RealtimeTimerRepository } from "./realtime-timer.repository.js";
import {
  type TimerStateChangedEvent,
  timerStateChangedEvent,
} from "./timer-state-changed.event.js";

@Injectable()
export class RealtimeService {
  constructor(
    @Inject(ApplicationEventBus)
    private readonly eventBus: ApplicationEventBus,
    @Inject(RealtimeTimerRepository)
    private readonly timerRepository: RealtimeTimerRepository,
  ) {}

  createPong(ping: RealtimePing): RealtimePong {
    return {
      sentAt: ping.sentAt,
      serverTime: new Date().toISOString(),
    };
  }

  getTimerState(): Promise<RealtimeTimerState> {
    return this.timerRepository.get();
  }

  async applyTimerCommand(
    command: RealtimeTimerCommand,
  ): Promise<RealtimeTimerState> {
    const { state, changed } = await this.timerRepository.apply(command);

    // The transaction has committed before either WebSocket or APNs publication.
    if (changed) {
      this.eventBus.publish<TimerStateChangedEvent>(timerStateChangedEvent, {
        action: command.action,
        state,
      });
    }

    return state;
  }
}
