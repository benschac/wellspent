# Timer monorepo

A Bun-managed Turborepo containing:

- `apps/web`: Next.js App Router application
- `apps/mobile`: Expo Router application for iOS, Android, and web
- `apps/api`: NestJS backend exposing oRPC-backed HTTP routes
- `packages/api-contract`: shared, runtime-validated oRPC contract
- `packages/api-client`: shared typed OpenAPI client factory
- `packages/database`: shared Drizzle schema, PostgreSQL client, and migrations
- `packages/typescript-config`: reusable TypeScript configurations
- `biome.json`: shared JavaScript/TypeScript linting and formatting

The web and mobile apps depend on the client package, the client depends on the
contract, and the NestJS app implements the contract. Apps never import one
another or reach across package boundaries.

## Requirements

- Bun 1.4+
- Node.js 22+
- Docker Desktop or another Docker-compatible container runtime
- Supabase CLI 2.116 (the scripts fetch the pinned CLI through `bunx`)
- Expo Go for the quickest mobile development loop

## Setup

Install dependencies:

```bash
bun install
```

Start the local Supabase stack, then create the environment files:

```bash
bun run supabase:start
cp apps/api/.env.example apps/api/.env
cp packages/database/.env.example packages/database/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env
```

The API and database-package examples connect to local Postgres at
`127.0.0.1:54422`. The API file is used at runtime; the database-package file is
used by Drizzle Kit. To use a hosted project instead, replace `DATABASE_URL`
with its server-only connection string and URL-encode special characters in the
password. Never expose database credentials through `NEXT_PUBLIC_*` or
`EXPO_PUBLIC_*` variables.

Then start every app through Turborepo:

```bash
bun run dev
```

The default local services are:

- Next.js: `http://localhost:3000`
- NestJS API: `http://localhost:3001/api`
- NestJS WebSocket: `ws://localhost:3001/api/ws`
- Expo development server: shown by the Expo CLI, normally port 8081
- Supabase API: `http://127.0.0.1:54421`
- Supabase database: `postgresql://postgres:postgres@127.0.0.1:54422/postgres`
- Supabase Mailpit: `http://127.0.0.1:54424`

This project reserves ports `54420-54429` for its Supabase stack, keeping it
separate from the other local projects on `54320-54329` and `64320-64329`.

On native development builds, the mobile client automatically replaces the
`localhost` API hostname with Metro's current host. Remote and production API
URLs are left unchanged. Only public, non-secret values belong in
`EXPO_PUBLIC_*` variables.

## Useful commands

Start with `bun run test:fast` for focus behavior and CLI capture; use
`bun run test:focus` or `bun run test:capture` for narrower checks.
`bun run test:focus:db:local` runs rollback-only tests against the already
running, migrated Timer database on port 54422. Tests have no Turbo build
prerequisite. `bun run test` also includes macOS Xcode tests, which compile
their native target. Builds remain separate below.

See [verification workflows](docs/verification.md), the
[current architecture checkpoint](docs/design/2026-08-29-focus-timer-product-and-sync-architecture.md#6-current-repository-boundary),
and [agent workflows and skill audit](docs/agent-workflows.md).

```bash
bun run lint
bun run format:check
bun run typecheck
bun run build
```

Run `bun run format` to apply Biome formatting across JavaScript, TypeScript,
JSON, and CSS files.

Manage the PostgreSQL schema with Drizzle-generated SQL and the Supabase CLI:

```bash
bun run db:check
bun run db:generate --name=describe_the_change
bun run db:migrate:local
bun run db:studio
```

Drizzle owns the desired application schema and generates timestamped SQL plus
metadata under `supabase/migrations`. Timer-owned tables live in the unexposed
PostgreSQL `app` schema; Supabase continues to own `auth.users`. Review generated
SQL before applying it, but do not append functions, triggers, grants, or other
manual SQL to generated structural migrations. Unsupported PostgreSQL objects
live in explicitly named Drizzle custom migrations. The Supabase CLI is the
migration applier and history authority; `db:migrate` is a convenience alias
for `db:migrate:local`.

Local Supabase lifecycle commands:

```bash
bun run supabase:start
bun run supabase:start:full
bun run supabase:start:lite
bun run supabase:status
bun run supabase:stop
```

Use Docker Desktop with `docker context use desktop-linux` before these commands.
The project is named `timer-desktop`; older `timer` volumes are kept separately.
The default start command runs the full stack, including Realtime, Storage,
Studio (`http://127.0.0.1:54423`), database metadata, and the Edge Functions
runtime. Local MCP is available at `http://127.0.0.1:54421/mcp` through Studio.
Use the `app` schema when inspecting Timer tables through MCP or Studio. This
local MCP endpoint is separate from a connector configured for hosted Supabase.
`supabase:start:lite` runs only Postgres, Auth, REST, the API gateway, and Mailpit;
it does not provide Studio or MCP. Both modes omit optional analytics, Vector
log shipping, and image transformation containers. Use the pinned commands above
because an older global Supabase CLI may reject the `local_smtp` configuration.

To rebuild the local database from committed migrations and `supabase/seed.sql`:

```bash
bun run db:reset:local
```

`db:reset:local` destroys local database data. It does not target a linked or
hosted project.

Run one application with a Turborepo filter:

```bash
bunx turbo run dev --filter=@repo/api
bunx turbo run dev --filter=@repo/web
bunx turbo run dev --filter=@repo/mobile
```

The starter endpoint is `GET /api/health`. Both frontends call it through
`createApiClient`, so input and output changes flow from the contract to every
consumer at typecheck time.

The API also exposes a native WebSocket transport probe at `/api/ws`. Messages
use Nest's `{ event, data }` envelope:

```json
{"event":"realtime.ping","data":{"sentAt":"2026-08-29T12:00:00.000Z"}}
```

The server replies with `realtime.pong`, echoing `sentAt` and adding
`serverTime`. Connected timer clients also send `timer.command` frames with a
`start`, `pause`, or `reset` action. The API broadcasts the resulting
`timer.state` snapshot to every connected client so web and mobile controls
converge immediately.

The shared realtime timer stores its snapshot in `app.realtime_timer_state`.
Start/pause/reset commits the new state before broadcasting. Reconnecting
clients receive that stored revision and timestamp after an API restart;
running timers include downtime, and paused timers stay paused. Apply the
`persist_realtime_timer` migration before running this API version. The first
rollout cannot reconstruct a timer that existed only in the old process's
memory; a missing stored row initializes once at zero, paused.

This remains one shared timer, separate from authenticated `/focus` sessions
and their history. It does not yet provide durable native offline commands,
account isolation, or cross-process live fan-out. Live Activity registrations
also remain in memory. Database failures report an error rather than silently
resetting the timer. See [realtime persistence verification](docs/verification.md#shared-timer-restart-persistence).

### Live Activity remote updates

The iOS timer starts ActivityKit activities with per-activity APNs update
tokens. While the mobile app is connected, it registers the current token with
the timer WebSocket. Subsequent `start`, `pause`, and running `reset`
transitions are sent to registered Live Activities through APNs; resetting a
paused timer ends and immediately dismisses them.

Remote updates are disabled by default. To enable them, create an Apple Push
Notifications authentication key and configure the API values documented in
`apps/api/.env.example`. Use the main app bundle identifier
(`com.benschac.timer`), not the widget extension identifier, and select the
sandbox APNs environment for development-signed builds.

The registration registry remains in memory: API restarts discard Live Activity
tokens, while the timer snapshot survives in Postgres. This path updates
activities already created by the iOS app. Remote
push-to-start requires a durable device registration so the server can avoid
creating duplicate activities and is not part of this slice.

## Adding an API feature

1. Add its contract under `packages/api-contract/src` with Zod input and output
   schemas plus oRPC OpenAPI routing metadata.
2. Add a feature module under `apps/api/src`; keep controllers, services, DTOs,
   and persistence for that feature together.
3. Implement the contract with `@Implement` and inject dependencies through the
   constructor.
4. Consume the new typed procedure through `@repo/api-client` from either app.

The oRPC NestJS integration currently uses the documented `2.0.0-beta.32`
packages. Keep all `@orpc/*` versions aligned when upgrading and consult the
[oRPC NestJS integration guide](https://orpc.dev/docs/integrations/nest) before
changing the adapter. Additional references: [Turborepo](https://turborepo.dev/docs),
[Next.js](https://nextjs.org/docs), [Expo](https://docs.expo.dev/), and
[NestJS](https://docs.nestjs.com/).

## Authentication and profiles

Supabase Auth is the canonical identity provider. Authenticated application
data goes through Nest rather than the Supabase Data API. An `auth.users`
`AFTER INSERT` trigger creates the matching `app.profiles` row in the same
transaction. `GET /api/profile` returns that profile, and `PATCH /api/profile`
atomically updates its optional application-owned fields.

## Google Calendar backend integration

The API contains an opt-in Google Calendar integration that creates a dedicated
`Focus Timer` secondary calendar for each connected user. It requests the
narrow `calendar.app.created` scope instead of access to every calendar. OAuth
refresh tokens are encrypted at rest, webhook channel tokens are stored only as
hashes, and Calendar changes are pulled through incremental sync into a durable
server-only inbox.

To enable it:

1. Enable the Google Calendar API and create a Google OAuth web client.
2. Register the exact `GOOGLE_OAUTH_REDIRECT_URI` from `apps/api/.env` as an
   authorized redirect URI.
3. Deploy the API at a public HTTPS address and set
   `GOOGLE_CALENDAR_WEBHOOK_URL` to its webhook endpoint.
4. Set the Supabase URL and publishable key so Nest can validate user access
   tokens.
5. Generate a 32-byte token-encryption key with `openssl rand -base64 32`.
6. Set `GOOGLE_CALENDAR_ENABLED=true` and apply the database migrations.

Endpoints:

- `GET /api/integrations/google-calendar/connect` — authenticated; returns the
  Google consent URL.
- `GET /api/integrations/google-calendar/callback` — Google OAuth callback.
- `GET /api/integrations/google-calendar/status` — authenticated connection and
  watch status.
- `DELETE /api/integrations/google-calendar` — authenticated Calendar-only
  disconnect; shared Google credentials remain available to Sheets.
- `POST /api/integrations/google-calendar/webhook` — authenticated through the
  stored Google channel token rather than a user bearer token.

Push notifications contain no event body. A durable Postgres worker claims jobs
with `FOR UPDATE SKIP LOCKED`, refreshes the user's Google access token, performs
incremental synchronization, and stores each deduplicated change in
`app.google_calendar_inbound_changes`. A later timer-domain slice should consume
that inbox and emit outbound Calendar projections only after durable timer
transitions commit; it must not synchronize a ticking counter every second.

## Google Sheets backend integration

The API can export selected completed focus sessions to a new spreadsheet using
Google's official SDK. Sheets and Calendar share encrypted Google credentials,
with incremental consent and independent feature disconnects. See
[Google Sheets setup, endpoints, and verification](docs/google-sheets.md).
