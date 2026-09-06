import type {
  RealtimeTimerCommand,
  RealtimeTimerState,
} from "@repo/api-contract";

export const timerStateChangedEvent = "timer.state.changed" as const;

export interface TimerStateChangedEvent {
  readonly action: RealtimeTimerCommand["action"];
  readonly state: RealtimeTimerState;
}
