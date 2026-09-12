# Work log from CLI and MCP

Record work without starting a timer. Entries belong to your account and can
optionally reference an existing focus session. The work log is separate from
session recaps and does not measure focused human time or verify completion.

## Setup

The API needs the reviewed `work_log` migration applied before use. Deploy API
and web together; this implementation does not apply production migrations.
Open `/work-log`, sign in, and create a token for your machine. Tokens expire
after 30 days, can be revoked in the same screen, and authorize only reading and
appending this account's work log. Only a hash is stored server-side. Work-log
tokens cannot manage credentials or control timers; old session capture tokens
do not authorize this API.

In macOS's default zsh, read the token without placing it in shell history:

```sh
read -rs 'TIMER_WORK_LOG_TOKEN?Paste work-log token: '
export TIMER_WORK_LOG_TOKEN
```

From this checkout (Bun and workspace dependencies installed):

```sh
bun integrations/work-log/cli.mjs configure <<'JSON'
{"apiOrigin":"http://localhost:3001","project":"timer"}
JSON
```

Use the actual API origin shown in `/work-log` (no `/api` suffix); hosted
origins require HTTPS. Configure verifies the credential's account and saves
only destination/account preferences to `~/.config/timer/work-log/config.json`.
It never saves the token. The directory must have mode 700 and files mode 600;
configuration inside the checkout is rejected. Every command accepts
`--config /absolute/private/path/config.json` for a separate destination.

## Log and read work

```sh
bun integrations/work-log/cli.mjs log <<'JSON'
{"summary":"Investigated authentication failures; traced them to an expired refresh token","project":"timer"}
JSON

bun integrations/work-log/cli.mjs list </dev/null
bun integrations/work-log/cli.mjs status
bun integrations/work-log/cli.mjs flush
```

`log` accepts `summary` and optional `project`, `sourceSessionId` (thread),
`occurredAt`, `id`, and `sessionId`. Source and kind are assigned by the adapter.
Use a unique UUID `id` for an entry and reuse it only for retries of that same
entry. Local retry preserves the first queued content and timestamp; IDs must
never be reused for different work. Explicit notes are saved as supplied
(trimmed), so include only information you intend to retain. Timestamp input
must be UTC ISO; the CLI serializes it to millisecond precision.

Output reports the entry's `acknowledged`, `queued`, or `rejected` state. A
successful local enqueue is not a successful upload. `status` reports local
queue counts and token presence; it does not verify credentials. `flush`
attempts at most 250 entries; repeat if pending work remains. No daemon or
periodic uploader is installed. Further log calls and hooks also retry.

To query a day, pass explicit UTC boundaries for the desired timezone. This
example is September 8, 2026 in America/New_York (EDT):

```sh
bun integrations/work-log/cli.mjs list <<'JSON'
{"from":"2026-09-08T04:00:00.000Z","to":"2026-09-09T04:00:00.000Z","limit":100}
JSON
```

`from` is inclusive, `to` exclusive. History is ordered newest first by event
time then UUID. When `nextCursor` is present, send it as `before` with the same
filters to read older entries. `/work-log` provides refresh and pagination too.

## Connect an MCP harness

Run `bun integrations/work-log/cli.mjs mcp` as a local stdio MCP server. It
exposes `log_work`, `list_work`, `flush_work`, and `work_log_status`. The server
uses the same private configuration and queue as the CLI; discovery works
without a credential, while reads/uploads require one. The stdio protocol
follows [MCP's newline-delimited JSON-RPC transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

Example [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
to merge with your existing configuration:

```toml
[mcp_servers.timer]
command = "/ABSOLUTE/PATH/TO/bun"
args = ["/ABSOLUTE/PATH/TO/timer/integrations/work-log/cli.mjs", "mcp"]
env_vars = ["TIMER_WORK_LOG_TOKEN"]
```

Launch the harness from the shell containing the environment variable. A
running desktop app does not inherit a new shell's environment; restart it via
the appropriate configured environment after changing a token. Never paste
credentials into prompts or tool arguments. This implementation adds no global
MCP registration automatically.

## Optional automatic Codex capture

Merge the handlers in [hooks.example.json](../integrations/work-log/hooks.example.json)
into your existing hook configuration, preserving existing handlers. Replace
both absolute paths, including the private work-log config path. These use the
existing dependency-free Node capture adapter, now with an account destination.
They record tool/turn metadata and explicit project labels; arguments, output,
prompts, paths, and transcripts are not uploaded. No timer is started.

Configure with `"shareAssistantSummary":true` only if you want excerpts of
assistant turn summaries saved. The default is false. Redaction is best effort;
summaries are marked `Agent-reported:` and do not prove completion. Recursion
filters exclude Timer logging tools and capture commands. Hook execution
cancelled before local publication can still be missed. See the existing
[capture delivery notes](../integrations/codex/README.md) for metadata/privacy
and background-hook limitations.

## Durability and isolation

Entries are published atomically to a private spool before upload. An
acknowledgment receipt is synced before deleting queued content. Stable IDs
and account-scoped database uniqueness make lost-response retries idempotent.
Invalid or incomplete acknowledgments retain unresolved entries. Permanently
rejected originals remain in `.rejected` files with their reason; future entries
can continue uploading. Future timestamps and invalid session references need
review rather than silent rewriting.

Destinations include origin and account. Replay verifies server identity before
transmitting content; changing accounts never retargets an old queue. Rotate
the token for the same account to retry expired credentials. Return to the old
configuration/account to flush its queued work.

The work-log queue permits 10,000 pending/rejected entries per destination.
Content-free acknowledgment receipts remain indefinitely and consume one small
file per delivered entry. No automatic pruning or evidence deletion is added.
Legacy session capture keeps its existing behavior and storage namespace.

## Verification

```sh
bun run test:capture
bun run --cwd packages/api-client typecheck
bun run --cwd apps/api typecheck
bun run --cwd apps/web typecheck
cd apps/api
WORK_LOG_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54422/postgres' bun test test/work-log.test.ts test/work-log.repository.integration.test.ts test/work-log.http.integration.test.ts
```

Database tests use Timer's fixed local database and roll back their fixtures,
including the new migration if it is not installed. They never inherit a
hosted `DATABASE_URL`. Unit transport tests use synthetic data. Connecting your
installed harness to a deployed API is a separate acceptance step requiring
your sign-in and a credential; no production connection is implied by tests.

Executed on 2026-09-08 in the working checkout: 29 capture/CLI/MCP unit tests
passed; four API/local database/HTTP tests passed. The HTTP fixture launched
real CLI and stdio MCP subprocesses against mounted Nest routes and Postgres,
including recovery of a queued entry in a new process. Only bootstrap account
authentication was substituted; work-log credential checks were real. API,
contract, client, database, and web typechecks passed. Drizzle metadata checks
passed. Browser interaction, deployed migrations, and installation into a live
signed-in harness remain unrun.
