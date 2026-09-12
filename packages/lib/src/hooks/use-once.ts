import { useRef } from "react";

/** Retains a value for this mount. The initializer must be pure: Strict Mode may call it twice. */
export function useOnce<T>(initialize: () => T): T {
  const box = useRef<{ value: T } | undefined>(undefined);
  if (box.current === undefined) box.current = { value: initialize() };
  return box.current.value;
}
