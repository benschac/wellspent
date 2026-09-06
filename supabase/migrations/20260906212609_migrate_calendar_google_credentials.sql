-- Preserve Calendar credentials and the existing encryption key. The shared
-- record becomes authoritative; legacy columns remain for rollback safety.
INSERT INTO app.google_connections
  (user_id, encrypted_refresh_token, granted_scopes, reconnect_required, created_at, updated_at)
SELECT user_id, encrypted_refresh_token, granted_scopes,
  status <> 'connected', created_at, updated_at
FROM app.google_calendar_connections
ON CONFLICT (user_id) DO NOTHING;

REVOKE ALL ON app.google_connections, app.google_oauth_states,
  app.google_sheets_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON app.google_connections, app.google_oauth_states,
  app.google_sheets_connections TO service_role;
