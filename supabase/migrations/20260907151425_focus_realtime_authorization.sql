-- Private receive-only focus channels. All content reads/writes remain in Nest.
CREATE POLICY focus_notifications_receive ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    extension = 'broadcast'
    AND (SELECT realtime.topic()) = 'focus:' || (SELECT auth.uid())::text
  );
--> statement-breakpoint
-- Keep focus topics isolated even if another feature adds broader policies.
CREATE POLICY focus_notifications_read_boundary ON realtime.messages
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    (SELECT realtime.topic()) NOT LIKE 'focus:%'
    OR (
      extension = 'broadcast'
      AND (SELECT realtime.topic()) = 'focus:' || (SELECT auth.uid())::text
    )
  );
--> statement-breakpoint
CREATE POLICY focus_notifications_server_publish_only ON realtime.messages
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK ((SELECT realtime.topic()) NOT LIKE 'focus:%');
