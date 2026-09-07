import type {
  RealtimeTimerCommand,
  RealtimeTimerState,
} from "@repo/api-contract";
import { differenceInMilliseconds, parseISO } from "date-fns";

export function transitionRealtimeTimer(
  state: RealtimeTimerState,
  command: RealtimeTimerCommand,
  now: number,
): RealtimeTimerState {
  if (
    (command.action === "start" && state.isRunning) ||
    (command.action === "pause" && !state.isRunning)
  ) {
    return state;
  }

  const elapsedMs =
    state.elapsedMs +
    (state.isRunning
      ? Math.max(0, differenceInMilliseconds(now, parseISO(state.updatedAt)))
      : 0);

  return {
    elapsedMs: command.action === "reset" ? 0 : elapsedMs,
    isRunning:
      command.action === "reset" ? state.isRunning : command.action === "start",
    revision: state.revision + 1,
    updatedAt: new Date(now).toISOString(),
  };
}
