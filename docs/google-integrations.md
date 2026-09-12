# Activate Google Sheets and Calendar

The web `/focus` page now has connection controls, saved completed-session selection, Sheets export, and Calendar publication status. Both integrations use one server-side Google credential owner. Google sign-in through Supabase does not connect these integrations automatically.

## 1. Choose the API environment

Keep the API's database, Supabase authentication, OAuth callbacks, return page, and webhook in the same environment. Do not send a local connection's webhook to the production API: production cannot recognize the locally stored channel.

For local development, set these individual values in `apps/api/.env`:

```dotenv
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3001/api/integrations/google-calendar/callback
GOOGLE_SHEETS_OAUTH_REDIRECT_URI=http://localhost:3001/api/integrations/google-sheets/callback
GOOGLE_INTEGRATIONS_RETURN_URL=http://localhost:3000/focus
```

Register both callbacks exactly on the Google OAuth web client. Populate `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` privately in that environment. Preserve the existing `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`; replacing it makes stored grants unreadable. Do not copy the example file over an existing `.env`.

Sheets can be activated first with `GOOGLE_SHEETS_ENABLED=true`. Calendar additionally needs a publicly reachable HTTPS tunnel to the local API, with `GOOGLE_CALENDAR_WEBHOOK_URL=https://YOUR-TUNNEL/api/integrations/google-calendar/webhook`, then `GOOGLE_CALENDAR_ENABLED=true`. The local API process runs its worker automatically. Restart the API after configuration changes. No Drive API implementation is required for these exports.

For production, configure the same secret names in the API host and use:

```dotenv
GOOGLE_OAUTH_REDIRECT_URI=https://api.wellspent.day/api/integrations/google-calendar/callback
GOOGLE_SHEETS_OAUTH_REDIRECT_URI=https://api.wellspent.day/api/integrations/google-sheets/callback
GOOGLE_INTEGRATIONS_RETURN_URL=https://wellspent.day/focus
GOOGLE_CALENDAR_WEBHOOK_URL=https://api.wellspent.day/api/integrations/google-calendar/webhook
```

The web API and Supabase environment must match this API. CORS must allow the selected web origin. Callback failures return a generic error to the configured page without exposing OAuth codes, state, or provider errors. Without a return URL, callbacks retain their original JSON behavior.

## 2. Database and scheduler

The September 6 shared Google migrations must be applied before enabling either feature. Local inspection on September 7 confirmed `20260906212601` and `20260906212609` are installed at `127.0.0.1:54422`; this says nothing about hosted migration state. This publication implementation reuses the existing jobs and event-link tables and needs no new migration.

On Vercel, in-process polling is disabled. Completed-session publication sends a bounded wake-up signal to the `google-calendar-jobs` Vercel Queue after the Postgres jobs commit. The private queue consumer calls the existing batch executor on the same deployment, with at most four consumer executions in flight. Queue messages contain no user, session, OAuth, or provider data. Vercel supplies queue authentication through OIDC automatically.

`apps/api/vercel.json` also schedules `GET /api/integrations/google-calendar/jobs/run` every five minutes for recovery when dispatch fails or accepted work becomes stranded. Configure a random `CRON_SECRET` of at least 16 characters in the API project; the queue consumer and Vercel Cron both use it as a bearer header. Keep it server-only. The endpoint fails closed if the secret is absent or wrong and does no work when Calendar is disabled. The queue consumer allows 300 seconds to accommodate token refresh and Google calls.

**The five-minute Vercel schedule requires Pro or Enterprise.** Hobby permits only daily schedules and rejects more frequent schedules at deployment. If using Hobby, remove this cron entry and use an existing authenticated external scheduler calling the same endpoint every five minutes, or run a persistent worker host. Do not upgrade a billing plan implicitly. Vercel cron runs on production deployments; preview acceptance needs an explicit scheduler invocation.

The worker processes up to ten jobs per invocation and stops starting jobs after twenty seconds; this is not a hard deadline for a job already running. A publication request sends enough wake-ups to cover its selected rows, while database claims make overlapping queue and cron executions safe. Existing paginated Calendar pulls can run longer. Abandoned claims are recovered after five minutes. Monitor queue message age, queued/dead database jobs, consumer failures, and scheduler errors; large calendars and sustained queue throughput need separate load acceptance.

No deployment, hosted migration, secret update, or live Google operation is performed by these source changes.

## 3. Product behavior and live acceptance

1. Sign into `/focus` on the selected environment. Connect Sheets and Calendar to the same Google account. Confirm the browser returns to `/focus` and the status becomes Connected.
2. Finish a durable focus session and wait for all browser commands to sync. Select its checkbox in history. The separate shared stopwatch is not exported.
3. Export to Sheets and open the resulting link. Confirm intention, UTC timestamps, focused seconds, and recap. Repeating this operation creates another spreadsheet, so a timeout requires checking Google Sheets before retrying.
4. Publish to Calendar. Observe Queued then Published after the worker runs. Check the “Focus Timer” calendar. An ordinary transparent event spans session creation through completion, including pauses; its description separately states focused seconds excluding pauses and includes the saved recap. Sessions with a zero/negative wall span are rejected rather than inventing time.
5. Publish the same session again and confirm exactly one event. Publication is an immutable snapshot: later recap changes and edits in Google are not overwritten. A failed job retry retains the original snapshot. Incoming Calendar changes remain recorded for later integration; they do not rewrite durable focus sessions.
6. Restart the API with queued work and confirm eventual completion. Check that Calendar watches renew and a Google edit creates an inbound change. Check refresh after access-token expiry, feature disconnect without breaking the other feature, and reconnect after revoking Google's grant.

Existing files/calendars remain after disconnect. Reconnecting Calendar after a disconnect creates a new app calendar and a new publication namespace. Two-way sync, automatically publishing every finished session, existing-personal-calendar reads, and moving files into Drive folders are outside this slice.

External OAuth apps in Testing issue refresh tokens with a seven-day lifetime for these scopes. Configure publishing status and any required Google verification before relying on long-lived production connections.

## Verification commands

From `apps/api`:

```sh
bun test test/google-oauth.service.test.ts test/google-sheets.test.ts test/google-calendar.service.test.ts test/google-calendar.http-client.test.ts test/google-calendar-publication.test.ts test/google-calendar-job-dispatcher.test.ts test/google-calendar-queue-consumer.test.ts test/google-calendar.job-runner.test.ts test/google-config.test.ts test/google-callback.test.ts
GOOGLE_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54422/postgres' bun test test/google.repository.integration.test.ts test/google-calendar-publication.repository.integration.test.ts
bun run typecheck
bun run build
```

From the root: `bun run --cwd apps/web test:focus`, `bun run --cwd apps/web typecheck`, and `bun run --cwd packages/api-client typecheck`. Database tests roll back their fixtures and never inherit `DATABASE_URL`. Callback HTTP tests bind a temporary local port. Unit tests use fake Google responses; they do not establish real consent, provider delivery, or deployed scheduler behavior.

References: [Google event IDs and insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Calendar webhooks](https://developers.google.com/workspace/calendar/api/guides/push), [Google token lifetime](https://developers.google.com/identity/protocols/oauth2), [Vercel Queues](https://vercel.com/docs/queues), [securing Vercel cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Vercel cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
