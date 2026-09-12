import { useEffect } from "react";
import { useOnce } from "./use-once";

/** Owns one cancellable operation scope, replaced on restart and aborted on unmount. */
export function useAbortController() {
  const scope = useOnce(() => {
    let current: AbortController | undefined;
    return {
      restart() {
        current?.abort();
        current = new AbortController();
        return current.signal;
      },
      abort() {
        current?.abort();
      },
    };
  });
  useEffect(() => () => scope.abort(), [scope]);
  return scope;
}
