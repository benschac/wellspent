# Codex working agreement

- Work autonomously through clear, reversible, in-scope tasks. Ask only for destructive, irreversible, credential-gated, production-writing, materially branching, or truly ambiguous actions.
- Preserve user changes and keep diffs small. Dirty worktrees are normal; do not alter unrelated work or add dependencies without authorization.
- Ground conclusions in the actual owning code, schema, row, log, policy, deployment artifact, or official documentation.
- Start production investigations read-only. Do not perform external writes or destructive SQL unless explicitly requested.
- Execute directly by default. Use native subagents only for bounded independent work that materially improves speed, quality, or safety; leaders own integration and verification.
- For cleanup or refactoring, state the cleanup plan and protect untested behavior before editing.
- Verify with the smallest relevant test, typecheck, lint, build, or static check. Read the result before claiming completion.
- Final reports state the outcome, changed files, validation evidence, and any remaining risk.

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

## TypeScript safety

- Never use non-null assertions (`value!`), including in tests. Use explicit runtime guards or assertion helpers that narrow the type and fail clearly when a required value is missing. Biome's `style.noNonNullAssertion` must remain an error.
- For intentional negative type tests, use `// @ts-expect-error: <reason>` on the invalid operation. Do not use it to bypass missing null checks in ordinary code or tests.

## Date and time

- For TypeScript date/time logic, use the `date-fns` skill when available and the repository's existing date-fns helpers. Parse and validate external timestamps at boundaries; pass `Date` values through date operations.
- Preserve monotonic stopwatch clocks (`performance.now()`), numeric millisecond durations, and UTC ISO transport precision (`Date.toISOString()`). Do not mechanically replace these with date-formatting helpers.
- Calendar-day reporting and scheduling must specify their timezone. Use `@date-fns/tz` when timezone helpers are needed, not `date-fns-tz`; elapsed-millisecond calculations do not require a timezone dependency.

## Repository map

- Durable focus product: `apps/web/app/focus` calls `apps/api/src/focus` through `packages/api-client` and `packages/api-contract`. Postgres is canonical; timer revisions, command idempotency, and recap revisions are distinct.
- Current browser persistence: `focus-outbox.ts` stores account-scoped commands and snapshots in `localStorage`; `use-focus-sessions.ts` owns replay. IndexedDB/SQLite repositories and cursor-based catch-up are planned, not implemented.
- Shared WebSocket timer: `packages/timer`, `apps/api/src/realtime`, `apps/mobile`, `apps/desktop` (Tauri), and `apps/macos` (SwiftUI/AppKit) use a separate singleton snapshot in `app.realtime_timer_state`, persisted before broadcast. API restarts preserve that timer; native offline queues and Live Activity registrations are still not durable. Do not mistake it for authenticated focus-session history/sync.
- CLI evidence: `integrations/codex` owns capture, its private spool, and delivery tests. Metadata is the default; assistant prose requires explicit opt-in. Evidence does not prove focused human time or completion.
- Schema: `packages/database/src/schema/index.ts` is Drizzle's desired state; reviewed SQL and metadata live in `supabase/migrations`. Use Drizzle generation for structural changes and named custom migrations for unsupported objects. Supabase CLI applies migrations. Preserve this ownership when using generic database skills.
- Local Timer Supabase: API `127.0.0.1:54421`, Postgres `127.0.0.1:54422`. Local verification must not inherit a hosted `DATABASE_URL` or reset an existing database.

## Current milestone and verification

The next outcome is durable repository recovery, beginning with shared session rules and an IndexedDB migration that preserves queued browser commands. Then connect physical Android to the same durable sessions. See [architecture checkpoint and task acceptance](docs/design/2026-08-29-focus-timer-product-and-sync-architecture.md#26-recommended-next-implementation-sequence); broader design sections describe target behavior unless the checkpoint marks it implemented.

- `bun run test:fast`: focus domain/browser and capture tests; no app builds or database.
- `bun run test:focus` / `bun run test:capture`: narrower checks.
- `bun run test:focus:db:local`: rollback-only integration tests against Timer's fixed local database; requires an already running, migrated stack and fails if unavailable.
- `bun run --cwd apps/api typecheck` / `bun run --cwd apps/web typecheck`: targeted static checks.
- Builds, HTTP smoke, and physical-device checks are separate; follow [verification](docs/verification.md). `bun run test` also includes macOS Xcode tests.

For focus persistence/replay verification, read [verify-focus-sync](docs/skills/verify-focus-sync/SKILL.md). For requested native/device acceptance, read [run-native-acceptance](docs/skills/run-native-acceptance/SKILL.md). These repository skills are linked here rather than installed into the global skill catalog. Their commands and evidence boundaries live in the verification guide. Keep task requests outcome-sized: scope, preserved behavior, acceptance evidence, and deferred work. Current source and executed checks take precedence over old progress notes.
