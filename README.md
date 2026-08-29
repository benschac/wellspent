# Timer monorepo

A Bun-managed Turborepo containing:

- `apps/web`: Next.js App Router application
- `apps/mobile`: Expo Router application for iOS, Android, and web
- `apps/api`: NestJS backend exposing oRPC-backed HTTP routes
- `packages/api-contract`: shared, runtime-validated oRPC contract
- `packages/api-client`: shared typed OpenAPI client factory
- `packages/database`: shared Drizzle schema, PostgreSQL client, and migrations
- `packages/typescript-config`: reusable TypeScript configurations
- `packages/eslint-config`: reusable ESLint flat configurations

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

When opening Expo Go on a physical device, replace `localhost` in
`apps/mobile/.env` with the computer's LAN address. For an Android emulator,
use `http://10.0.2.2:3001` when it cannot resolve the host through `localhost`.
Only public, non-secret values belong in `EXPO_PUBLIC_*` variables.

## Useful commands

```bash
bun run lint
bun run typecheck
bun run build
```

Manage the PostgreSQL schema with Drizzle-generated SQL and the Supabase CLI:

```bash
bun run db:check
bun run db:generate --name=describe_the_change
bun run db:migrate:local
bun run db:studio
```

Drizzle owns the TypeScript schema and generates timestamped SQL plus metadata
under `supabase/migrations`. Review generated SQL before applying it. The
Supabase CLI is the migration applier and history authority; `db:migrate` is a
convenience alias for `db:migrate:local`.

Local Supabase lifecycle commands:

```bash
bun run supabase:start
bun run supabase:start:full
bun run supabase:status
bun run supabase:stop
```

The default start command runs the services used by the current architecture:
Postgres, Auth, REST, the API gateway, and Mailpit. `supabase:start:full` also
starts Realtime, Storage, Studio (`http://127.0.0.1:54423`), and the Edge
Functions runtime. Both commands omit optional analytics, Vector log shipping,
and image transformation containers. Use the full stack when Docker has enough
memory available; Supabase recommends at least 7 GB for local development.

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
`serverTime`. This probe verifies transport availability; durable timer sync
continues to use HTTP catch-up and Supabase Realtime as described in the design
record.

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
