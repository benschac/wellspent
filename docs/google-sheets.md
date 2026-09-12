# Google Sheets backend

The backend exports selected **completed durable focus sessions** into a new Google spreadsheet. It uses Google's official `@googleapis/sheets` client and `google-auth-library`. The web `/focus` page now provides connection controls and session selection. It does not export the separate shared WebSocket timer or expose arbitrary spreadsheet access. See [activation and live acceptance](google-integrations.md) for the complete setup.

## Configuration

1. Enable the Google Sheets API in the same Google Cloud project as Calendar. Keep the same OAuth web client ID/secret.
2. Add `GOOGLE_SHEETS_OAUTH_REDIRECT_URI` to that client's authorized redirect URIs. For local API development: `http://localhost:3001/api/integrations/google-sheets/callback`.
3. Set `GOOGLE_SHEETS_ENABLED=true`, the redirect URI, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` in the API environment.
4. Keep the existing `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`: despite its legacy name, this 32-byte base64 key now encrypts shared Google credentials. Do **not** replace an existing key. Generate one only for a new installation (`openssl rand -base64 32`).
5. Apply the reviewed database migrations through Supabase before running the new backend. They add server-only Google credential/state/Sheets tables and backfill existing Calendar credentials without changing their ciphertext. No hosted migrations are applied automatically.

Sheets can be enabled without Calendar or its HTTPS webhook. Production callback URLs should use HTTPS. Users must complete consent for the new `drive.file` permission; enabling a flag does not upgrade existing grants. This narrow scope covers files created/opened with the app, not every spreadsheet in the user's Drive. OAuth also requests `openid` to bind the grant to a verified Google account.

## Authentication and ownership

API requests use the existing Supabase user bearer token. That application token is **not** a Google access token. Calendar and Sheets share one encrypted Google refresh credential per app user; access tokens are refreshed server-side. The current Google sign-in flow does not automatically import provider credentials into this store.

Consent requests use offline access, PKCE, single-use expiring state bound to the authenticated user and integration, and incremental authorization. Adding Sheets preserves Calendar permissions and rejects a different Google account. Legacy Calendar records have no stored Google subject, so their account is verified from the old grant before adopting a new one. If that old grant is invalid or cannot identify the account, explicitly disconnect all Google integrations and reconnect.

Per-feature disconnect removes that feature's state without revoking the shared Google grant. `DELETE /api/integrations/google` is the explicit **all-Google disconnect**: it revokes the shared grant and removes both integrations. Neither disconnect deletes already exported spreadsheets or the Google Calendar. Existing exports remain in Drive.

## Endpoints

All endpoints except the state-validated OAuth callback require `Authorization: Bearer <Supabase access token>`.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/integrations/google-sheets/connect` | `{ authorizationUrl }`; open it in a browser |
| GET | `/api/integrations/google-sheets/callback` | Google redirect; `{ connected: true }` |
| GET | `/api/integrations/google-sheets/status` | `{ connected, reconnectRequired }` |
| POST | `/api/integrations/google-sheets/export` | New spreadsheet and exported count |
| DELETE | `/api/integrations/google-sheets` | Disable Sheets only; 204 |
| DELETE | `/api/integrations/google` | Revoke/disconnect all Google integrations; 204 |

Export request:

```json
{ "sessionIds": ["10000000-0000-4000-8000-000000000001"] }
```

Export response:

```json
{
  "spreadsheetId": "google-generated-id",
  "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/google-generated-id/edit",
  "exportedSessionCount": 1
}
```

Each request creates a snapshot with session ID, intention, UTC start/completion timestamps, persisted elapsed seconds (excluding pauses), and saved recap text. Sessions are ordered by creation time then ID. Select 1–500 unique session IDs; all must belong to the signed-in user and be completed, otherwise the entire request is rejected. Payloads above 1 MB are rejected. Strings are literal cells, never formulas. No capture logs or raw work events are exported.

Exports are not idempotent: repeating a request creates another spreadsheet. Automatic provider retries are disabled. After a timeout, check Drive before retrying because Google may have created the file even if the response was lost. There is no ongoing synchronization or export-job storage in this first slice.

## Verification

From `apps/api`:

```sh
bun test test/google-oauth.service.test.ts test/google-sheets.test.ts test/google-calendar.service.test.ts test/google-calendar.http-client.test.ts
bun run typecheck
bun run build
GOOGLE_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54422/postgres' bun test test/google.repository.integration.test.ts
```

The opt-in database test runs against the existing local Timer stack, applies any missing new Google tables inside its transaction, verifies migration backfill/permissions and repository ownership, then rolls everything back. It never reads `DATABASE_URL` or resets the database. Unit tests mock Google: real consent, refresh, Calendar continuity, and spreadsheet creation still require a configured Google project and a test account.

Official references: [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes), [Sheets REST API](https://developers.google.com/workspace/sheets/api/reference/rest), [incremental OAuth authorization](https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth).
