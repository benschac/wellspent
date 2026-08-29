import { useCallback, useEffect, useMemo, useRef } from "react";

export interface SetTimeoutControls {
  clear: () => void;
  schedule: (callback: () => void, delayMs: number) => void;
}

export function useSetTimeout(): SetTimeoutControls {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const clear = useCallback(() => {
    if (timeoutRef.current === undefined) {
      return;
    }

    globalThis.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  }, []);

  const schedule = useCallback(
    (callback: () => void, delayMs: number) => {
      clear();
      timeoutRef.current = globalThis.setTimeout(() => {
        timeoutRef.current = undefined;
        callback();
      }, delayMs);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  return useMemo(() => ({ clear, schedule }), [clear, schedule]);
}
