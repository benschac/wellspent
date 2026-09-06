import { requireNativeModule } from "expo";
import type {
  TimerLiveActivityNativeModule,
  TimerLiveActivityPushToken,
  TimerLiveActivityState,
} from "./TimerLiveActivity.types";

const nativeModule =
  requireNativeModule<TimerLiveActivityNativeModule>("TimerLiveActivity");

export const startOrUpdateTimerLiveActivity = (
  state: TimerLiveActivityState,
  startIfMissing = true,
): Promise<string | null> => nativeModule.startOrUpdate(state, startIfMissing);

export const endTimerLiveActivity = (): Promise<void> => nativeModule.end();

export const onTimerLiveActivityPushToken = (
  listener: (event: TimerLiveActivityPushToken) => void,
): { remove(): void } => nativeModule.addListener("onPushToken", listener);

export type { TimerLiveActivityPushToken, TimerLiveActivityState };
