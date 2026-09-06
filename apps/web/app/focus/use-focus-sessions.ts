"use client";

import type { ApiClient } from "@repo/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createFocusOutbox, type FocusOutbox } from "./focus-outbox";
import {
  errorMessage,
  projectCommand,
  type FocusCommand,
  type FocusSession,
} from "./focus-state";

export function useFocusSessions(api: ApiClient, userId: string) {
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [pending, setPending] = useState<FocusCommand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const outbox = useRef<FocusOutbox | null>(null);
  const syncing = useRef(false);
  const active = useRef(true);
  const blockedRef = useRef(false);
  const requests = useRef<AbortController | null>(null);

  const display = useCallback(() => {
    if (!active.current || !outbox.current) return;
    const commands = outbox.current.readCommands();
    setPending(commands);
    setSessions(commands.reduce(projectCommand, outbox.current.readSessions()));
  }, []);

  const sync = useCallback(async () => {
    const store = outbox.current;
    if (syncing.current || blockedRef.current || !active.current || !store)
      return;
    syncing.current = true;
    const signal = requests.current?.signal;
    const replay = async () => {
      // Reload after acquiring the lock and after each acknowledgement. Other tabs
      // can enqueue while this request is in flight; only the acknowledged key is removed.
      let command = store.readCommands()[0];
      while (command && active.current && !signal?.aborted) {
        const session =
          command.type === "create"
            ? await api.focus.create(command.input, { signal })
            : await api.focus.transition(command.input, { signal });
        if (!active.current || signal?.aborted) return;
        store.saveSessions([session]);
        store.acknowledge(command.input.commandId);
        display();
        command = store.readCommands()[0];
      }
      const fetched = await api.focus.list(undefined, { signal });
      if (!active.current || signal?.aborted) return;
      // Persist every fresh baseline, including sessions started on another device.
      store.saveSessions(fetched);
      display();
      setError(null);
    };
    try {
      if (navigator.locks) {
        await navigator.locks.request(
          `timer-focus-sync:${userId}`,
          { ifAvailable: true },
          async (lock) => {
            if (lock) await replay();
          },
        );
      } else {
        // Immutable command keys prevent lost writes, and the server deduplicates IDs.
        await replay();
      }
    } catch (cause) {
      if (!active.current || signal?.aborted) return;
      const status =
        typeof cause === "object" && cause !== null && "status" in cause
          ? Number(cause.status)
          : 0;
      if (status === 401) {
        setError(
          "Your sign-in needs to refresh. Timer actions are kept and will retry. Sign out and sign back in if syncing does not resume.",
        );
      } else if (
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 429
      ) {
        blockedRef.current = true;
        setBlocked(true);
        setError(
          `${errorMessage(cause)} Pending timer actions are retained. You can discard them and use the server state below.`,
        );
      } else {
        let hasPending = false;
        try {
          hasPending = store.readCommands().length > 0;
        } catch {
          setError(
            "Saved timer actions could not be read. Your pending work has not been removed.",
          );
          return;
        }
        setError(
          hasPending
            ? "Timer actions are saved on this browser and will retry when connected."
            : errorMessage(cause),
        );
      }
    } finally {
      syncing.current = false;
    }
  }, [api, display, userId]);

  useEffect(() => {
    active.current = true;
    requests.current = new AbortController();
    try {
      outbox.current = createFocusOutbox(localStorage, userId);
      display();
      // Browser storage is unavailable during server rendering; mark readiness only
      // after restoring it on mount, before allowing any timer action.
      setReady(true);
      void sync();
    } catch {
      setError(
        "Your browser could not open the saved timer actions. Enable browser storage before starting a session.",
      );
    }
    const interval = setInterval(() => void sync(), 10_000);
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea !== localStorage ||
        (event.key && !event.key.startsWith(outbox.current?.prefix ?? ""))
      )
        return;
      try {
        display();
        void sync();
      } catch {
        setError(
          "Saved timer actions could not be read. Your pending work has not been removed.",
        );
      }
    };
    window.addEventListener("online", sync);
    window.addEventListener("storage", onStorage);
    return () => {
      active.current = false;
      requests.current?.abort();
      clearInterval(interval);
      window.removeEventListener("online", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [display, sync, userId]);

  function enqueue(command: FocusCommand) {
    if (!ready || blockedRef.current || !outbox.current) return false;
    try {
      // Persist first: storage failures cannot masquerade as saved timer actions.
      outbox.current.add(command);
      display();
      void sync();
      return true;
    } catch (cause) {
      setError(`This action could not be saved. ${errorMessage(cause)}`);
      return false;
    }
  }

  async function discardPending() {
    const store = outbox.current;
    if (syncing.current || !store) return;
    // Capture exactly the commands the user saw and confirmed. New actions from a
    // different tab must survive this discard operation.
    const discardedIds = store
      .readCommands()
      .map((command) => command.input.commandId);
    const discard = async () => {
      const fetched = await api.focus.list();
      if (!active.current) return;
      store.saveSessions(fetched);
      for (const id of discardedIds) store.acknowledge(id);
      blockedRef.current = false;
      setBlocked(false);
      setError(null);
      display();
    };
    try {
      if (navigator.locks)
        await navigator.locks.request(`timer-focus-sync:${userId}`, discard);
      else await discard();
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    }
  }

  return {
    sessions,
    pending,
    error,
    blocked,
    ready,
    enqueue,
    refresh: sync,
    discardPending,
  };
}
