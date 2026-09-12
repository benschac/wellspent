import { z } from "zod";

// An invalidation hint, never a command, session snapshot, or sync cursor.
export const focusChangedEvent = "focus.changed";
export const focusChangedSchema = z.strictObject({
  version: z.literal(1),
  sessionId: z.uuid(),
});

export function focusNotificationTopic(userId: string): string {
  return `focus:${z.uuid().parse(userId).toLowerCase()}`;
}
