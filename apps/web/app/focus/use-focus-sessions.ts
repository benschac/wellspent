"use client";

import type { ApiClient } from "@repo/api-client";
import { useAbortController } from "@repo/lib/hooks/use-abort-controller";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createFocusOutbox } from "./focus-outbox";
import {
  createFocusSessionSync,
  initialFocusSessionsState,
} from "./focus-session-sync";
import type { FocusCommand } from "./focus-state";

export function useFocusSessions(
  api: ApiClient,
  userId: string,
) {
  const [state, setState] = useState(initialFocusSessionsState);
  const requests = useAbortController();
  const sync = useRef<ReturnType<typeof createFocusSessionSync> | null>(null);
  const changed = useEffectEvent(() => {
    setState((current) => ({
      ...current,
      refreshVersion: current.refreshVersion + 1,
    }));
    void sync.current?.sync();
  });

  useEffect(() => {
    const signal = requests.restart();
    setState(initialFocusSessionsState());
    try {
      const storage = localStorage;
      const store = createFocusOutbox(storage, userId);
      const controller = createFocusSessionSync({
        api,
        userId,
        store,
        signal,
        locks: navigator.locks,
        publish: (patch) => {
          if (!signal.aborted)
            setState((current) => ({ ...current, ...patch }));
        },
      });
      controller.display();
      // Storage is only opened after mounting; actions require a restored outbox.
      sync.current = controller;
      setState((current) => ({ ...current, ready: true }));
      const refresh = () => void controller.sync();
      refresh();
      const interval = setInterval(refresh, 10_000);
      signal.addEventListener("abort", () => clearInterval(interval), {
        once: true,
      });
      const onStorage = (event: StorageEvent) => {
        if (
          event.storageArea !== storage ||
          (event.key && !event.key.startsWith(store.prefix))
        )
          return;
        try {
          controller.display();
          refresh();
        } catch {
          setState((current) => ({
            ...current,
            error:
              "Saved timer actions could not be read. Your pending work has not been removed.",
          }));
        }
      };
      const onVisible = () => {
        if (document.visibilityState === "visible") changed();
      };
      window.addEventListener("online", refresh, { signal });
      window.addEventListener("focus", changed, { signal });
      window.addEventListener("storage", onStorage, { signal });
      document.addEventListener("visibilitychange", onVisible, { signal });
    } catch {
      requests.abort();
      sync.current = null;
      setState((current) => ({
        ...current,
        ready: false,
        error:
          "Your browser could not open the saved timer actions. Enable browser storage before starting a session.",
      }));
    }
    return () => {
      requests.abort();
      sync.current = null;
    };
  }, [api, userId, requests]);

  return {
    ...state,
    enqueue: (command: FocusCommand) => sync.current?.enqueue(command) ?? false,
    refresh: async () => sync.current?.sync(),
    discardPending: async () => sync.current?.discardPending(),
  };
}
