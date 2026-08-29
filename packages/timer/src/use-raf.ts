import { useEffect, useEffectEvent } from "react";

export type RafCallback = (timestamp: number) => void;

export function useRaf(callback: RafCallback, enabled = true): void {
  const onFrame = useEffectEvent(callback);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let frameId = 0;

    const frame = (timestamp: number) => {
      onFrame(timestamp);
      frameId = globalThis.requestAnimationFrame(frame);
    };

    frameId = globalThis.requestAnimationFrame(frame);

    return () => globalThis.cancelAnimationFrame(frameId);
  }, [enabled]);
}
