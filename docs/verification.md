# Verification workflows

Run commands from the repository root after `bun install --frozen-lockfile`. Package scripts own the checks; root commands delegate through Turbo. Test tasks are uncached so a reported pass is a fresh execution. They have no Turbo build prerequisite; the macOS test command still compiles its Xcode test target.

## Fast focus checks

| Command | What it establishes |
| --- | --- |
| `bun run test:fast` | Runs both focus behavior and standalone capture suites, without app builds or database access. |
| `bun run test:focus` | API transition/evidence rules and browser projection, outbox, and bearer-token behavior. |
| `bun run test:capture` | Synthetic hook capture, privacy defaults, durable spool/replay, acknowledgements, and rejection handling. |
| `bun run --cwd apps/web test` | All web Bun tests; included in the full workspace test command. |
| `bun run test:focus:db:local` | Actual repository transactions, ownership, revisions, deduplication, and token/evidence boundaries on local Postgres. |

The database command fixes `FOCUS_TEST_DATABASE_URL` to `127.0.0.1:54422/postgres`. It does not use `DATABASE_URL`, does not reset or migrate the database, and does not silently skip when local Postgres is unavailable. Fixtures roll back their changes. Start Timer's existing local stack and apply reviewed pending migrations before using it (`bun run supabase:start`, `bun run db:migrate:local`). Keep setup separate from verification.

Direct `bun run --cwd apps/api test` includes the repository suite but skips it unless `FOCUS_TEST_DATABASE_URL` is explicitly supplied. That skip is not database acceptance; use the named local command for database evidence.

These checks do not demonstrate browser IndexedDB transactions, React lifecycle behavior, physical-device recovery, live Codex hook installation, or production behavior. The current browser outbox tests use a storage double; the capture tests use synthetic inputs and a fake transport.

## Static checks, builds, and HTTP smoke

### Vercel API compilation

The API's `vercel.json` installs with Bun 1.4.0 and `--frozen-lockfile` because
Bun 1.3 cannot read this repository's version-2 lockfile. Keep this version in
sync with the root `packageManager` when upgrading Bun.

Vercel compiles the API again after `nest build`. Keep `module` and `strict`
explicit in `apps/api/tsconfig.json`: Vercel's compiler applies defaults before
resolving inherited options. ESM output with Bundler resolution avoids mixed
Drizzle import/require declarations in that compiler's custom resolver. The DOM
library supplies the standard fetch types used by Node; `types: ["node"]` keeps
Node globals explicit. These settings do not change the Node runtime.

The API build's Turbo passthrough list declares runtime configuration without
hashing secrets into compilation inputs. Passing the Nest build alone does not
prove Vercel's second compilation or a deployed HTTP response.

### Package checks

Choose the relevant package, rather than running every build after a small change:

```sh
bun run --cwd apps/api typecheck
bun run --cwd apps/web typecheck
bun run --cwd packages/database db:check
bun run --cwd apps/api build
bun run --cwd apps/web build
```

`bun run test` runs all workspace test scripts, including macOS Xcode tests; it requires the corresponding toolchains. `bun run build` remains the separate workspace build path.

For a local HTTP/auth/restart acceptance run:

```sh
node apps/api/test/focus-http.smoke.mjs
```

The smoke helper requires the running, migrated Timer Supabase stack; validates the local API/database addresses; builds and starts its own API; creates disposable Auth users; exercises real JWTs, routes, token scope, hook delivery, and API restart; then removes its test users and stops its process. It is intentionally outside the fast suite. It does not install hooks into a live Codex session. See [capture setup](../integrations/codex/README.md) for that separate acceptance boundary.

## Shared timer restart persistence

```sh
bun run --cwd apps/api test:realtime
bun run --cwd apps/api test:realtime:restart:local
```

The first command checks transition compatibility, commit-before-publication, and gateway failure handling. Run it from the package script so Bun uses the API's legacy-decorator TypeScript configuration.

The second requires Timer Postgres on `127.0.0.1:54422`. It builds the actual Node API, creates a uniquely named `timer_restart_test_*` database, applies only the new shared-timer schema there, starts its own API on a free port, sends real WebSocket commands, and abruptly kills/restarts that process. It checks running, paused, and reset snapshots, elapsed downtime, concurrent commands, and rejected writes. Cleanup closes test connections and removes only that generated database. It does not alter the existing Timer database, run hosted migrations, or restart a user's API process.

Deploy/apply `20260906224232_persist_realtime_timer.sql` before using the persisted timer implementation. The shared snapshot is separate from authenticated focus sessions. Existing memory-only state cannot be reconstructed on the initial rollout, and Live Activity registrations still need to be re-registered after an API restart.

## Native acceptance

First identify which path the requested change affects: the current WebSocket prototype or durable focus sessions. As of September 6, native clients only implement the prototype. Report durable-session acceptance as unimplemented until its product integration exists; do not score a prototype test as convergence proof.

For static/native checks, use the existing package commands:

```sh
bun run --cwd apps/mobile typecheck
bun run --cwd apps/macos test
bun run --cwd apps/macos build
```

Use an existing development build for physical checks. `bun run android:device` reverses the Metro/API ports, force-stops the selected Android app, and launches it; it does not build/install the app. Select a specific device with `ANDROID_SERIAL` when needed. `bun run --cwd apps/mobile android` builds/installs Android, and `bun run ios:device` builds/installs on the configured iPhone. Read their current scripts before using them. Mac commands use the local Xcode project; unsigned builds do not establish signing/distribution readiness.

For the durable sync milestone, record these observations on physical Android and a browser using the same test account:

1. Start a session on web and pause it on Android; compare session ID, revision, and elapsed duration.
2. Disconnect Android, resume/pause locally, terminate and reopen it, and verify pending IDs/timestamps and the paused projection survive. The test must actually interrupt the app process, not merely reload JavaScript.
3. Reconnect, retry a command after a lost acknowledgement, and verify one canonical transition per command ID.
4. Issue incompatible commands from the same revision; inspect the visible correction and retained rejected event. Verify a second session can still synchronize.
5. Expire authentication, perform local actions, reauthenticate, and check replay and account isolation. Inspect foreground recovery after suspension without depending on push delivery.

Use [the architecture failure matrix](design/2026-08-29-focus-timer-product-and-sync-architecture.md#194-failure-and-compatibility-matrix) for the complete release gate. iOS Live Activity/APNs and Mac lifecycle changes need their own device observations; neither unit tests nor successful native linking prove provider delivery.

An acceptance record includes date, commit plus relevant dirty changes, app/build versions, OS and device, local or deployed backend, exact scenario/commands, observed IDs/revisions/counts, and pass/fail/unrun. Keep credentials, intentions, and raw captured content out of the record. Missing hardware limits only dependent checks; complete the independent checks and report the boundary.
