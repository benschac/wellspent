import { Injectable } from "@nestjs/common";
import type {
  RealtimePing,
  RealtimePong,
  RealtimeTimerCommand,
  RealtimeTimerState,
} from "@repo/api-contract";

@Injectable()
export class RealtimeService {
  private timerState: RealtimeTimerState = {
    elapsedMs: 0,
    isRunning: false,
    revision: 0,
    updatedAt: new Date().toISOString(),
  };

  createPong(ping: RealtimePing): RealtimePong {
    return {
      sentAt: ping.sentAt,
      serverTime: new Date().toISOString(),
    };
  }

  getTimerState(): RealtimeTimerState {
    return { ...this.timerState };
  }

  applyTimerCommand(command: RealtimeTimerCommand): RealtimeTimerState {
    const now = Date.now();
    const currentElapsedMs = this.timerState.isRunning
      ? this.timerState.elapsedMs +
        Math.max(0, now - Date.parse(this.timerState.updatedAt))
      : this.timerState.elapsedMs;

    switch (command.action) {
      case "start":
        if (this.timerState.isRunning) {
          return this.getTimerState();
        }

        this.timerState = {
          elapsedMs: currentElapsedMs,
          isRunning: true,
          revision: this.timerState.revision + 1,
          updatedAt: new Date(now).toISOString(),
        };
        break;
      case "pause":
        if (!this.timerState.isRunning) {
          return this.getTimerState();
        }

        this.timerState = {
          elapsedMs: currentElapsedMs,
          isRunning: false,
          revision: this.timerState.revision + 1,
          updatedAt: new Date(now).toISOString(),
        };
        break;
      case "reset":
        this.timerState = {
          elapsedMs: 0,
          isRunning: this.timerState.isRunning,
          revision: this.timerState.revision + 1,
          updatedAt: new Date(now).toISOString(),
        };
        break;
    }

    return this.getTimerState();
  }
}
