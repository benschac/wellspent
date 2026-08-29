import {
  realtimeTimerCommandEvent,
  realtimeTimerStateEvent,
  realtimeTimerStateSchema,
  type RealtimeTimerCommand,
  type RealtimeTimerState,
} from "@repo/api-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import { useRaf } from "./use-raf";
import { useWebSocket } from "./use-web-socket";

export interface Stopwatch {
  elapsedMs: number;
  elapsedSnapshotAtMs: number;
  isRunning: boolean;
  pause: () => void;
  realtimeRevision: number | null;
  reset: () => void;
  start: () => void;
}

export interface UseStopwatchOptions {
  realtimeUrl?: string;
  reconnectDelayMs?: number;
  updateIntervalMs?: number;
}

interface ElapsedSnapshot {
  elapsedMs: number;
  sampledAtMs: number;
}

type TimerAction = RealtimeTimerCommand["action"];

const readClock = (): number => globalThis.performance?.now() ?? Date.now();

export function useStopwatch(
  options: UseStopwatchOptions = {},
): Stopwatch {
  const { realtimeUrl, reconnectDelayMs = 1_000, updateIntervalMs } = options;
  const [elapsedSnapshot, setElapsedSnapshot] = useState<ElapsedSnapshot>(() => ({
    elapsedMs: 0,
    sampledAtMs: readClock(),
  }));
  const [isRunning, setIsRunning] = useState(false);
  const [realtimeRevision, setRealtimeRevision] = useState<number | null>(null);
  const accumulatedMsRef = useRef(0);
  const isRunningRef = useRef(false);
  const latestRevisionRef = useRef(-1);
  const startedAtRef = useRef<number | null>(null);

  const updateElapsed = useCallback(() => {
    const startedAt = startedAtRef.current;

    if (startedAt !== null) {
      const sampledAtMs = readClock();

      setElapsedSnapshot({
        elapsedMs:
          accumulatedMsRef.current + sampledAtMs - startedAt,
        sampledAtMs,
      });
    }
  }, []);

  useRaf(updateElapsed, isRunning && updateIntervalMs === undefined);

  useEffect(() => {
    if (!isRunning || updateIntervalMs === undefined) {
      return;
    }

    const interval = setInterval(updateElapsed, updateIntervalMs);

    return () => clearInterval(interval);
  }, [isRunning, updateElapsed, updateIntervalMs]);

  const applyRealtimeState = useCallback((state: RealtimeTimerState) => {
    if (state.revision <= latestRevisionRef.current) {
      return;
    }

    const elapsedSinceUpdate = state.isRunning
      ? Math.max(0, Date.now() - Date.parse(state.updatedAt))
      : 0;
    const nextElapsedMs = state.elapsedMs + elapsedSinceUpdate;
    const sampledAtMs = readClock();

    latestRevisionRef.current = state.revision;
    setRealtimeRevision(state.revision);
    accumulatedMsRef.current = nextElapsedMs;
    isRunningRef.current = state.isRunning;
    startedAtRef.current = state.isRunning ? sampledAtMs : null;
    setElapsedSnapshot({ elapsedMs: nextElapsedMs, sampledAtMs });
    setIsRunning(state.isRunning);
  }, []);

  const sendRealtimeMessage = useWebSocket({
    url: realtimeUrl,
    reconnectDelayMs,
    onOpen: () => {
      latestRevisionRef.current = -1;
    },
    onMessage: (data) => {
      if (typeof data !== "string") {
        return;
      }

      try {
        const message = JSON.parse(data) as {
          data?: unknown;
          event?: unknown;
        };

        if (message.event === realtimeTimerStateEvent) {
          const state = realtimeTimerStateSchema.safeParse(message.data);

          if (state.success) {
            applyRealtimeState(state.data);
          }
        }
      } catch {
        // Ignore malformed frames and keep the last valid timer state.
      }
    },
  });

  const sendAction = useCallback((action: TimerAction) => {
    sendRealtimeMessage(
      JSON.stringify({
        event: realtimeTimerCommandEvent,
        data: { action },
      }),
    );
  }, [sendRealtimeMessage]);

  const start = useCallback(() => {
    if (isRunningRef.current) {
      sendAction("start");
      return;
    }

    const sampledAtMs = readClock();

    startedAtRef.current = sampledAtMs;
    isRunningRef.current = true;
    setElapsedSnapshot((snapshot) => ({ ...snapshot, sampledAtMs }));
    setIsRunning(true);
    sendAction("start");
  }, [sendAction]);

  const pause = useCallback(() => {
    if (!isRunningRef.current || startedAtRef.current === null) {
      sendAction("pause");
      return;
    }

    const sampledAtMs = readClock();
    const nextElapsedMs =
      accumulatedMsRef.current + sampledAtMs - startedAtRef.current;

    accumulatedMsRef.current = nextElapsedMs;
    startedAtRef.current = null;
    isRunningRef.current = false;
    setElapsedSnapshot({ elapsedMs: nextElapsedMs, sampledAtMs });
    setIsRunning(false);
    sendAction("pause");
  }, [sendAction]);

  const reset = useCallback(() => {
    const sampledAtMs = readClock();

    accumulatedMsRef.current = 0;
    startedAtRef.current = isRunningRef.current ? sampledAtMs : null;
    setElapsedSnapshot({ elapsedMs: 0, sampledAtMs });
    sendAction("reset");
  }, [sendAction]);

  return {
    elapsedMs: elapsedSnapshot.elapsedMs,
    elapsedSnapshotAtMs: elapsedSnapshot.sampledAtMs,
    isRunning,
    pause,
    realtimeRevision,
    reset,
    start,
  };
}
