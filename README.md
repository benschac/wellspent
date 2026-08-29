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
- Expo Go for the quickest mobile development loop

## Setup

Install dependencies:

```bash
bun install
```

Create package-local environment files:

```bash
cp apps/api/.env.example apps/api/.env
cp packages/database/.env.example packages/database/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env
```

For Supabase, replace `DATABASE_URL` in both database environment files with
the Shared Pooler URI from the project's **Connect** panel. The API file is used
at runtime; the database-package file is used by Drizzle Kit. Keep this URI
server-only and URL-encode special characters in the database password.

Then start every app through Turborepo:

```bash
bun run dev
```

The default local services are:

- Next.js: `http://localhost:3000`
- NestJS API: `http://localhost:3001/api`
- Expo development server: shown by the Expo CLI, normally port 8081

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

Manage the PostgreSQL schema through Drizzle:

```bash
bun run db:check
bun run db:generate
bun run db:migrate
bun run db:studio
```

`db:migrate` writes to the database selected by `packages/database/.env`, so
verify that target before running it.

Run one application with a Turborepo filter:

```bash
bunx turbo run dev --filter=@repo/api
bunx turbo run dev --filter=@repo/web
bunx turbo run dev --filter=@repo/mobile
```

The starter endpoint is `GET /api/health`. Both frontends call it through
`createApiClient`, so input and output changes flow from the contract to every
consumer at typecheck time.

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
