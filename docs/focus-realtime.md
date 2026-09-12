# Focus live notifications

The authenticated web focus flow can receive private Supabase Broadcast hints after Nest saves a session creation, timer transition, recap edit, or manual note. Other signed-in browser sessions then reload through the authenticated HTTP API. The existing account-scoped outbox and ten-second HTTP polling remain the recovery path. Joining/rejoining a channel and returning to the foreground also trigger a refresh.

This is an optional notification layer over the current list/detail API. It does not implement the planned device/cursor protocol, native durable sessions, background push, or a job queue. CLI evidence ingestion and Google job status still use their existing refresh behavior. The separate shared `/api/ws` timer is unchanged.

## Configuration

1. Apply the reviewed `20260907151425_focus_realtime_authorization.sql` migration through the normal Supabase migration workflow. Local setup uses Timer's existing stack and `bun run db:migrate:local`; review all pending migrations first. A full local stack is required for live sockets (`supabase:start:lite` excludes Realtime). Tests do not apply persistent migrations.
2. Set `FOCUS_REALTIME_ENABLED=true`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` on the API. The secret is the project's server-only Supabase secret key; local development can use the local service-role JWT. Never put it in a `NEXT_PUBLIC_*` variable.
3. Set `NEXT_PUBLIC_FOCUS_REALTIME_ENABLED=true` on the web deployment, with its existing Supabase URL and publishable key pointing at the same project as the API. Rebuild the web app because public configuration is compiled into the client.

Both flags default to false so existing deployments continue working until configuration and the migration are in place. Disabling either flag leaves HTTP recovery available. This change does not provision or deploy hosted credentials or policies.

## Transport and authorization

The private topic is `focus:<authenticated-user-UUID>`. Its only event is `focus.changed`, containing `{ "version": 1, "sessionId": "<UUID>" }`. Intentions, notes, recaps, tokens, and snapshots are never broadcast. A received hint is never treated as a successful command acknowledgement.

The browser reuses its existing Supabase client, including JWT refresh, and removes the channel when the account's workspace unmounts. Policies permit authenticated receive on the user's topic and deny client publication to all `focus:` topics. Restrictive policies keep this boundary intact if another feature later adds broader permissions. Nest publishes with its server credential only after the repository operation resolves.

Nest awaits the REST broadcast with a one-second timeout so Vercel does not need to keep work alive after a response. A failed notification produces a generic warning and does not turn an already committed action into an HTTP error. This adds the broadcast request's latency to the save acknowledgement, up to the timeout during an outage. A process failure between commit and broadcast can still lose a hint; HTTP refresh repairs that gap. Notifications are deliberately not a durable queue.

## Verification

```sh
bun run test:focus
bun run --cwd apps/api typecheck
bun run --cwd apps/web typecheck
FOCUS_REALTIME_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54422/postgres' bun test apps/api/test/focus-notifications.policy.integration.test.ts
```

The policy test temporarily installs the policy inside a rolled-back transaction against Timer's fixed local database. It tests own-user receive, cross-user and anonymous denial, and client publication denial, including when another feature supplies broad permissive policies. Unit tests cover commit-before-notify, failure fallback, payload validation, reconnect hints, and subscription cleanup. They do not establish browser-rendered or hosted delivery.

For deployment acceptance, open two authenticated browser sessions for the same account, create/pause/finish a session, and edit its recap/add a note. Confirm the second view refreshes before its next polling interval and preserves any local draft. Repeat across different accounts to verify isolation. Interrupt the socket, make a change, and confirm polling and reconnection repair it. Inspect WebSocket events without recording credentials or private content. Check that notes and recaps still save when their own live notification arrives.

Protocol references: [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast) and [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).
