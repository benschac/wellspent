import { useEffect, useRef } from "react";

export interface SetTimeoutControls {
  clear: () => void;
  schedule: (callback: () => void, delayMs: number) => void;
}

export function useSetTimeout(): SetTimeoutControls {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const clear = () => {
    if (timeoutRef.current === undefined) {
      return;
    }

    globalThis.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  };

  const schedule = (callback: () => void, delayMs: number) => {
    clear();
    timeoutRef.current = globalThis.setTimeout(() => {
      timeoutRef.current = undefined;
      callback();
    }, delayMs);
  };

  useEffect(() => clear, [clear]);

  return { clear, schedule };
}
