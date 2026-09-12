import { useEffect, useEffectEvent } from "react";

/**
 * Runs the latest callback once after delayMs. Pass null to disable.
 * Changing the delay restarts the timeout; changing the callback does not.
 */
export function useSetTimeout(callback: () => void, delayMs: number | null) {
  const onTimeout = useEffectEvent(callback);

  useEffect(() => {
    if (delayMs === null) return;
    const timeout = setTimeout(() => onTimeout(), delayMs);
    return () => clearTimeout(timeout);
  }, [delayMs]);
}
