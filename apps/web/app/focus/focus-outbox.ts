import { focusSessionSchema } from "@repo/api-client";
import { z } from "zod";
import {
  commandsSchema,
  type FocusCommand,
  type FocusSession,
} from "./focus-state";

type BrowserStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

// Immutable entries prevent tabs from replacing one another's pending commands.
// Account-scoped keys survive a closed tab/browser without sessionStorage pointers.
export function createFocusOutbox(storage: BrowserStorage, userId: string) {
  const prefix = `focus:${userId}:`;
  const commandPrefix = `${prefix}command:`;
  const snapshotKey = `${prefix}sessions`;
  function readCommands(): FocusCommand[] {
    const commands: FocusCommand[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(commandPrefix)) continue;
      const raw = storage.getItem(key);
      if (raw) commands.push(commandsSchema.parse([JSON.parse(raw)])[0]!);
    }
    return commands.sort(
      (a, b) =>
        a.input.occurredAt.localeCompare(b.input.occurredAt) ||
        (a.type === "create" ? 0 : a.input.expectedRevision) -
          (b.type === "create" ? 0 : b.input.expectedRevision) ||
        a.input.commandId.localeCompare(b.input.commandId),
    );
  }
  function readSessions(): FocusSession[] {
    const raw = storage.getItem(snapshotKey);
    return raw ? z.array(focusSessionSchema).parse(JSON.parse(raw)) : [];
  }
  function saveSessions(sessions: FocusSession[]) {
    const merged = new Map(
      readSessions().map((session) => [session.id, session]),
    );
    for (const session of sessions) {
      const previous = merged.get(session.id);
      // A slower tab's response cannot replace a newer timer revision or recap.
      if (!previous) merged.set(session.id, session);
      else
        merged.set(session.id, {
          ...(session.revision >= previous.revision ? session : previous),
          recapText:
            session.recapRevision >= previous.recapRevision
              ? session.recapText
              : previous.recapText,
          recapRevision: Math.max(
            session.recapRevision,
            previous.recapRevision,
          ),
        });
    }
    storage.setItem(
      snapshotKey,
      JSON.stringify(
        [...merged.values()]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 100),
      ),
    );
  }
  function add(command: FocusCommand) {
    commandsSchema.parse([command]);
    const key = commandPrefix + command.input.commandId;
    const previous = storage.getItem(key);
    if (previous) {
      if (previous !== JSON.stringify(command))
        throw new Error("A different action already uses this command ID.");
      return;
    }
    if (readCommands().length >= 1000)
      throw new Error(
        "1,000 timer actions are waiting to sync. Reconnect before recording more.",
      );
    storage.setItem(key, JSON.stringify(command));
  }
  function acknowledge(commandId: string) {
    storage.removeItem(commandPrefix + commandId);
  }
  return { prefix, readCommands, readSessions, saveSessions, add, acknowledge };
}
export type FocusOutbox = ReturnType<typeof createFocusOutbox>;
