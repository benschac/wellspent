export interface TimerLiveActivityState {
  elapsedMs: number;
  isRunning: boolean;
  originEpochMs: number;
  realtimeUrl: string;
}

export interface TimerLiveActivityPushToken {
  activityId: string;
  pushToken: string;
}

export const startOrUpdateTimerLiveActivity = async (
  _state: TimerLiveActivityState,
  _startIfMissing = true,
): Promise<string | null> => null;

export const endTimerLiveActivity = async (): Promise<void> => {};

export const onTimerLiveActivityPushToken = (
  _listener: (event: TimerLiveActivityPushToken) => void,
): { remove(): void } => ({ remove: () => {} });
