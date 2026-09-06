# Codex focus-session capture

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
bun test integrations/codex/timer-capture.test.mjs
node --check integrations/codex/timer-capture.mjs
```

The tests cover default data minimization, consent, stable IDs, replay after acknowledgment, concurrent delivery, interrupted deletion, tampered queue fields, mixed accepted/rejected batches, quarantine retention, invalid dispositions, offline retention, acknowledgments, bounded batches, private permissions, and destination changes. They use synthetic inputs and a fake transport; an installed Codex session and deployed Timer API still require an end-to-end acceptance run.
