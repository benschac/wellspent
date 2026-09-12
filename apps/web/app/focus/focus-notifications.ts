import {
  focusChangedEvent,
  focusChangedSchema,
  focusNotificationTopic,
} from "@repo/api-client";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Notifications are hints. Every join/rejoin reloads through the authenticated API. */
export function subscribeToFocusChanges(
  supabase: SupabaseClient,
  userId: string,
  onChange: () => void,
) {
  let disposed = false;
  let channel: ReturnType<SupabaseClient["channel"]> | undefined;
  void (async () => {
    const { data, error } = await supabase.auth.getSession();
    if (disposed || error || data.session?.user.id !== userId) return;
    // The shared Supabase client supplies and refreshes the authenticated JWT.
    channel = supabase
      .channel(focusNotificationTopic(userId), { config: { private: true } })
      .on("broadcast", { event: focusChangedEvent }, ({ payload }) => {
        if (!disposed && focusChangedSchema.safeParse(payload).success)
          onChange();
      })
      .subscribe((status) => {
        if (!disposed && status === "SUBSCRIBED") onChange();
      });
  })().catch(() => {
    // HTTP polling and foreground recovery continue if joining fails.
  });
  return () => {
    disposed = true;
    if (channel) void supabase.removeChannel(channel).catch(() => {});
  };
}
