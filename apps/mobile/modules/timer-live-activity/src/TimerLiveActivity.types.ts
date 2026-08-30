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

export interface TimerLiveActivityNativeModule {
  addListener(
    eventName: "onPushToken",
    listener: (event: TimerLiveActivityPushToken) => void,
  ): { remove(): void };
  startOrUpdate(
    state: TimerLiveActivityState,
    startIfMissing: boolean,
  ): Promise<string | null>;
  end(): Promise<void>;
}
