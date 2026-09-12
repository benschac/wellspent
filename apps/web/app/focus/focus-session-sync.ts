import type { ApiClient } from "@repo/api-client";
import type { FocusOutbox } from "./focus-outbox";
import {
  errorMessage,
  type FocusCommand,
  type FocusSession,
  projectCommand,
} from "./focus-state";

export type FocusSessionsState = {
  sessions: FocusSession[];
  pending: FocusCommand[];
  error: string | null;
  blocked: boolean;
  ready: boolean;
  refreshVersion: number;
};

export function initialFocusSessionsState(): FocusSessionsState {
  return {
    sessions: [],
    pending: [],
    error: null,
    blocked: false,
    ready: false,
    refreshVersion: 0,
  };
}

/** One effect lifetime owns its replay flags and signal; stale requests cannot affect a new lifetime. */
export function createFocusSessionSync({
  api,
  userId,
  store,
  signal,
  locks,
  publish,
}: {
  api: { focus: Pick<ApiClient["focus"], "list" | "create" | "transition"> };
  userId: string;
  store: FocusOutbox;
  signal: AbortSignal;
  locks?: LockManager;
  publish: (patch: Partial<FocusSessionsState>) => void;
}) {
  let syncing = false;
  let syncAgain = false;
  let blocked = false;
  const setError = (error: string | null) => publish({ error });
  const display = () => {
    if (signal.aborted) return;
    const commands = store.readCommands();
    publish({
      pending: commands,
      sessions: commands.reduce(projectCommand, store.readSessions()),
    });
  };

  const sync = async () => {
    if (blocked || signal.aborted) return;
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncAgain = false;
    syncing = true;
    const readLatest = async () => {
      if (signal.aborted) return;
      const fetched = await api.focus.list(undefined, { signal });
      if (signal.aborted) return;
      store.saveSessions(fetched);
      display();
      setError(null);
    };
    const replay = async () => {
      // Reload after acquiring the lock and after each acknowledgement. Other tabs
      // can enqueue while this request is in flight; only the acknowledged key is removed.
      let command = store.readCommands()[0];
      while (command && !signal.aborted) {
        const session =
          command.type === "create"
            ? await api.focus.create(command.input, { signal })
            : await api.focus.transition(command.input, { signal });
        if (signal.aborted) return;
        store.saveSessions([session]);
        store.acknowledge(command.input.commandId);
        display();
        command = store.readCommands()[0];
      }
      // Persist every fresh baseline, including sessions started on another device.
      await readLatest();
    };
    try {
      if (locks) {
        await locks.request(
          `timer-focus-sync:${userId}`,
          { ifAvailable: true },
          async (lock) => {
            if (lock) await replay();
            // Another tab owns command replay; this tab can still refresh its view.
            else await readLatest();
          },
        );
      } else {
        // Immutable command keys prevent lost writes, and the server deduplicates IDs.
        await replay();
      }
    } catch (cause) {
      if (signal.aborted) return;
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
        blocked = true;
        publish({ blocked: true });
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
      syncing = false;
      // A hint received during an HTTP request may describe a newer commit.
      if (syncAgain && !signal.aborted) void sync();
    }
  };

  function enqueue(command: FocusCommand) {
    if (signal.aborted || blocked) return false;
    try {
      // Persist first: storage failures cannot masquerade as saved timer actions.
      store.add(command);
      display();
      void sync();
      return true;
    } catch (cause) {
      setError(`This action could not be saved. ${errorMessage(cause)}`);
      return false;
    }
  }

  async function discardPending() {
    if (signal.aborted || syncing) return;
    // Capture exactly the commands the user saw and confirmed. New actions from a
    // different tab must survive this discard operation.
    let discardedIds: string[] = [];
    const discard = async () => {
      if (signal.aborted) return;
      const fetched = await api.focus.list(undefined, { signal });
      if (signal.aborted) return;
      store.saveSessions(fetched);
      for (const id of discardedIds) store.acknowledge(id);
      blocked = false;
      publish({ blocked: false });
      setError(null);
      display();
    };
    syncing = true;
    try {
      discardedIds = store
        .readCommands()
        .map((command) => command.input.commandId);
      if (locks)
        await locks.request(`timer-focus-sync:${userId}`, { signal }, discard);
      else await discard();
    } catch (cause) {
      if (!signal.aborted) setError(errorMessage(cause));
    } finally {
      syncing = false;
      if (syncAgain && !signal.aborted) void sync();
    }
  }

  return { display, sync, enqueue, discardPending };
}
