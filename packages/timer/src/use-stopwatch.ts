import { useCallback, useRef, useState } from "react";

import { useRaf } from "./use-raf";

export interface Stopwatch {
  elapsedMs: number;
  isRunning: boolean;
  pause: () => void;
  reset: () => void;
  start: () => void;
}

const readClock = (): number => globalThis.performance?.now() ?? Date.now();

export function useStopwatch(): Stopwatch {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const accumulatedMsRef = useRef(0);
  const isRunningRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  const updateElapsed = useCallback(() => {
    const startedAt = startedAtRef.current;

    if (startedAt !== null) {
      setElapsedMs(accumulatedMsRef.current + readClock() - startedAt);
    }
  }, []);

  useRaf(updateElapsed, isRunning);

  const start = useCallback(() => {
    if (isRunningRef.current) {
      return;
    }

    startedAtRef.current = readClock();
    isRunningRef.current = true;
    setIsRunning(true);
  }, []);

  const pause = useCallback(() => {
    if (!isRunningRef.current || startedAtRef.current === null) {
      return;
    }

    const nextElapsedMs =
      accumulatedMsRef.current + readClock() - startedAtRef.current;

    accumulatedMsRef.current = nextElapsedMs;
    startedAtRef.current = null;
    isRunningRef.current = false;
    setElapsedMs(nextElapsedMs);
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    accumulatedMsRef.current = 0;
    startedAtRef.current = isRunningRef.current ? readClock() : null;
    setElapsedMs(0);
  }, []);

  return { elapsedMs, isRunning, pause, reset, start };
}
