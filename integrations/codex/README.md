# Codex focus-session capture

## Local macOS AI Harness

For local recording notes (C4a), run `bun run dev` from the repository root, or
`bun run dev:harness` for only this integration. With a `b` alias for Bun, these
are `b dev` and `b dev:harness`. Node 22+ and the Codex CLI must already be
installed. Run `bun install --frozen-lockfile` to install Execa, the MCP SDK and Zod;
no API server, cloud token, or database is required.

1. Keep the dev command running and rebuild/run the current macOS app.
2. Choose **Workspace → Local Recordings…** (**⌘⇧R**) → **AI Harness** →
   **Connect Codex…**, then approve the disclosed installation.
3. Start a new Codex session to discover `wellspent-local` / `log_work`.
4. Explicitly start/resume a local recording before submitting a selected note.
   Notes are reports, not verified completion or focused human time.

The dev supervisor runs outside App Sandbox. It handles only fresh, explicitly
approved Connect/Disconnect requests from the app's private directory, and
serves an existing installed, nonrevoked connection. Startup alone never changes
Codex registration or starts recording. It does not install automatic hooks,
read transcripts, or upload notes. Connect preserves unrelated MCP registrations
and refuses an unrelated `wellspent-local` name collision.

For the signed sandboxed macOS app, state lives in
`~/Library/Containers/com.benjaminschachter.timer.macos/Data/.config/wellspent/codex-harness`.
Directories are private (0700), files are private (0600), and keys are never
printed or placed in Codex configuration. Dev control messages contain no note
text or credentials. A runner-specific heartbeat prevents an old pending request
from being replayed after dev restarts. Existing evidence is retained on shutdown
and revocation. Only the supervisor's own listener is closed.

If Connect says the dev server is unavailable, start/restart `bun run dev:harness`
and retry in the rebuilt app. If Codex is unavailable, verify `codex --version`
in that terminal. A name collision requires resolving the existing registration;
the app does not overwrite an unrelated connection. After moving the checkout,
explicit Connect repairs an owned registration. Keep dev running for delivery;
packaged background-service installation is not part of this development setup.

The older unsandboxed app-owned helper uses `~/.config/wellspent/codex-harness`.
For that development build only, the supervisor can target its private root with
`node integrations/codex/harness-dev.mjs --root /absolute/private/root`.

### Local MCP implementation and verification

`harness-dev.ts`, `harness-helper.ts`, and `harness-mcp.ts` are the checked
TypeScript sources. The helper uses Execa for bounded Codex CLI execution, while
the MCP server uses the official `@modelcontextprotocol/server` 2.0.0
`McpServer` and `StdioServerTransport`, with a strict Zod input schema. The
4096-byte limit uses UTF-8 byte length; whitespace-only text, malformed Unicode,
extra properties and malformed UUIDs are rejected before calling the helper.
The existing helper still owns connection checks, durable admission, receipts,
UUID conflicts and retries. Only a native acknowledged receipt is success.
Every non-success result also explains how to retain the original ID/text.

Initialization binds once to the local connection; discovery and tool calls
cannot adopt a replacement connection. A small SDK `Server` subclass uses the protected `_wrapHandler` extension point
for initialization/discovery guards, and the `McpServer` subclass installs it
before registering tools. There is no external protected-member access or type
suppression. Keep the SDK pinned and rerun the wire tests before upgrading this
integration seam.

SDK differences: invalid tool inputs now produce `isError: true` tool results;
invalid protocol envelopes still use SDK protocol errors. Malformed JSON lines
are skipped, invalid envelopes report a generic stderr diagnostic, and an
incomplete final line is discarded at EOF. The SDK decodes invalid UTF-8 bytes
with replacement characters instead of the old fatal decoder. Its buffer is
capped at 128 KiB; the old separate 16 KiB per-line limit is gone. The note
limit remains 4096 UTF-8 bytes. Requests can run concurrently; durable helper
operations retain their existing locks and idempotency rules. Revoked
connections now fail initialization immediately as well as later operations.

The tiny `.mjs` launchers preserve stable Node command paths. `bun run --cwd
integrations/codex build:harness` compiles self-contained Node bundles beside
them; generated output is ignored by Git. Execa, the MCP SDK, Zod, and the local
storage/contract modules are bundled, so the installed commands do not resolve
workspace `node_modules` or source modules at runtime. Development and test
scripts build first. Restart development after editing the TypeScript source.
`bun run --cwd integrations/codex typecheck` checks all three TypeScript sources
in strict mode.

Run `bun run --cwd integrations/codex test:harness` for real SDK stdio,
loopback-helper, retry, byte-limit, CLI and bundle tests using temporary roots.
The macOS resource script bundles both the native helper and MCP entry point with
Bun (targeting Node), so building those resources requires Bun and installed
workspace dependencies; running either bundled command requires only Node.
These tests simulate native acknowledgements; they do not establish live
Codex/macOS UI or signed-distribution acceptance.

## Hosted capture

For a work log without starting or selecting a focus session, use the
[account work-log setup](../../docs/work-log.md). This adapter supports both
destinations; the instructions below retain the original session-bound flow.

A dependency-free Node 22+ hook adapter for Timer. It records selected Codex activity against one explicitly selected focus session. It never starts a timer, installs hooks, changes Codex settings, or obtains credentials automatically.

## Connect a session

1. Start a focus session in Timer, open **Connect CLI**, and create a capture token. Use the session UUID and API origin shown there. The capture token can only append Codex work events to that session; it expires after 24 hours and can be revoked.
2. From this checkout, configure the destination using JSON on stdin:

   ```sh
   node integrations/codex/timer-capture.mjs configure <<'JSON'
   {
     "apiOrigin": "http://localhost:3000",
     "sessionId": "REPLACE-WITH-FOCUS-SESSION-UUID",
     "shareAssistantSummary": false
   }
   JSON
   ```

   Replace the API origin with your API's actual origin, without `/api`. Hosted origins require HTTPS. Configuration lives outside the checkout at `~/.config/timer/codex/config.json`, with directory mode 700 and file mode 600. You can pass `--config /absolute/private/directory/config.json` to every command; use a dedicated directory with mode 700. Re-running `configure` explicitly changes the selected session.

3. Supply the token in the shell that will launch Codex, without putting it into shell history or a file. In macOS's default zsh:

   ```sh
   read -rs 'TIMER_CAPTURE_TOKEN?Paste capture token: '
   export TIMER_CAPTURE_TOKEN
   ```

   Press Enter after pasting. The adapter reads `TIMER_CAPTURE_TOKEN` from its environment and never saves it. Start `codex` from this shell so its hooks inherit the variable. An already-running desktop app does not inherit this shell's environment. There is no Keychain integration in this version.

4. Merge the handlers from [hooks.example.json](./hooks.example.json) into your Codex `hooks.json`, replacing `/ABSOLUTE/PATH/TO/timer` with the actual checkout path. Preserve existing hooks. If `node` is unavailable on Codex's PATH, also replace it with the absolute path from `command -v node`. For a custom config path, append `--config '/absolute/private/directory/config.json'` to each command. Review/trust the hooks in Codex as prompted.

   This adapter uses the documented `PostToolUse` and `Stop` stdin JSON events and background command handlers (`async: true`). Background hooks can be cancelled when Codex exits, so an invocation cancelled before its local write may be missing. [Official Codex hook reference](https://learn.chatgpt.com/docs/hooks).

5. Check setup and retry any saved activity:

   ```sh
   node integrations/codex/timer-capture.mjs status
   node integrations/codex/timer-capture.mjs flush
   ```

   `status` shows active queued counts and quarantined-event counts for the selected session and other destinations, rejection counts by reason, and whether the token environment variable is present. It never prints the token. `flush` reports the numbers acknowledged and quarantined, and a reason. A missing, expired, or revoked token leaves queued events in place; reissue a token for the same session, update the environment, and retry. Restart the CLI if its inherited token changed.

## What is shared

The default event contains an opaque Codex thread ID, event ID, timestamp, tool or turn completion kind, and a short metadata description such as `Tool completed: Bash (reported success).` Only explicit structured `isError` or `exit_code` fields contribute a result label; textual output is not interpreted as evidence of success.

Tool arguments, command text, output, prompts, working-directory paths, and transcript files are never stored or uploaded. Tool arguments are inspected only to exclude calls to this adapter or its event endpoint, preventing capture recursion. Unknown thread identifiers are hashed if they are not already simple opaque identifiers. No screen recording, accessibility permission, transcript access, MCP server, or additional package is required.

Setting `shareAssistantSummary` to `true` explicitly opts into sharing an excerpt of the last assistant message when a turn completes. It is limited to 1,950 characters, strips paths, links, control characters, and common secret patterns, and starts with `Agent-reported:`. Redaction is best effort: assistant messages can contain sensitive prose, so keep this option disabled unless you consent to sharing their content. This excerpt is the agent's claim, not verified completion. Turning it off affects new events; already queued excerpts retain the consent choice at capture time.

## Delivery behavior

- Capture writes a private local spool before uploading. Event UUIDs are derived from the focus session, origin, Codex thread, and invocation ID where available. Repeated hook delivery and network retries reuse the ID and preserve the first queued timestamp. Content-free acknowledgment receipts are atomically saved before deleting uploaded events, so a later delivery of the same invocation is skipped even after the original queue entry is gone. Receipts remain private for the lifetime of that destination. If an invocation lacks a tool/turn ID, it receives a random UUID.
- Events are bound to their original API origin and focus session. Changing configuration never moves an old queue to the new session. Reconfigure the original destination and provide a valid token for that session to flush it.
- Requests use `POST /api/focus/sessions/:sessionId/work-events`, `Authorization: Bearer …`, and `{ "events": [...] }`, with at most 50 events per batch. Only IDs explicitly listed in a successful response's `acceptedEventIds` are marked delivered. The API must acknowledge duplicates as well as new inserts. `rejectedEvents` can identify `outside_session`, `future_timestamp`, `id_conflict`, or `session_limit`; the adapter durably preserves those originals, their destination, and their rejection reason in private `.rejected` quarantine files before removing them from the active queue. Later valid batches continue uploading. Rejected IDs cannot be re-enqueued automatically. Missing `rejectedEvents` is supported for older servers. Unknown, overlapping, duplicate, or malformed dispositions leave the entire affected batch queued.
- Each request has a two-second timeout and rejects redirects. A capture invocation attempts one batch; manual `flush` attempts at most five. Subsequent hooks or manual flush retry retained activity. No background daemon or periodic scheduler is installed.
- Pending events, acknowledgment receipts, and quarantined originals count toward a local limit of 10,000 events per destination. At that limit, new events are skipped with a generic warning; existing events and receipts remain. Start a new focus session to capture more; removing receipts for the same session can reintroduce duplicate-delivery conflicts. Hook stdin is limited to 1 MiB, so an oversized tool result is skipped in its entirety. These limits bound work even when an upstream tool returns unusually large data.
- Hooks return neutral JSON and never request continuation or stop the harness. Their five-second background timeout further limits runtime. Durable capture does not imply that every harness event was observed, or that background agent runtime equals focused human time.

To disconnect, remove these hook handlers and `unset TIMER_CAPTURE_TOKEN` in the launching shell; revoke the token in Timer. Local queues remain until acknowledged or explicitly deleted by you. The adapter does not upload previously queued activity unless a matching destination is selected and a token is available. Quarantined events are retained for local review; they are never retried, deleted, or attached to another session automatically. Check `status` for the reason, then inspect the private spool locally if needed. After a completed session or a session limit, configure a new focus session for new activity. Correct a clock problem before capturing new events; the adapter does not rewrite original timestamps.

## Verification

```sh
bun run test:capture
node --check integrations/codex/timer-capture.mjs
```

The tests cover default data minimization, consent, stable IDs, replay after acknowledgment, concurrent delivery, interrupted deletion, tampered queue fields, mixed accepted/rejected batches, quarantine retention, invalid dispositions, offline retention, acknowledgments, bounded batches, private permissions, and destination changes. They use synthetic inputs and a fake transport; an installed Codex session and deployed Timer API still require an end-to-end acceptance run.
