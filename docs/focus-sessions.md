# Durable focus sessions and CLI context

Implemented September 5, 2026. The web `/focus` route is the first authenticated session-to-recap flow. The original anonymous stopwatch and native clients still use their existing realtime prototype; they do not share this new session history yet.

## Identity and persistence

Supabase Auth owns accounts and login sessions. The existing `create_profile_on_auth_user` trigger provisions `app.profiles` in the signup transaction. Its function uses an empty search path and cannot be invoked by Data API users. Focus sessions reference that profile, and deleting the Auth user cascades through the profile to their focus records.

Nest validates the Supabase bearer token once through the existing auth guard. All normal focus procedures derive ownership from that identity, never a user ID in a request body. The `app` schema remains private and its tables keep default-deny RLS; clients use the authenticated API instead of direct table access.

The new migration adds:

- `app.focus_sessions`: intention, timer projection, independent user-edited recap and recap revision.
- `app.focus_transitions`: immutable start/pause/resume/finish commands, timestamps and idempotency fingerprints.
- `app.focus_work_events`: selected timestamped evidence with its source and harness thread.
- `app.focus_capture_tokens`: a hash of one expiring capture credential per session.

Commands lock their session, check the expected timer revision, and commit the transition and projection together. Reusing an ID with a different payload is a conflict. Recap edits do not change timer revisions. Event delivery does not change either revision.

## Run locally

Use the existing local Timer Supabase stack on ports 54420–54429, separate from Treasure It. Never point test commands at a hosted project.

1. Start the local stack with `bun run supabase:start` and apply migrations with `bun run db:migrate:local`. Do not reset an existing database.
2. Configure `apps/api/.env` using its example: local `DATABASE_URL`, `SUPABASE_URL=http://127.0.0.1:54421`, and the local publishable/anon key as `SUPABASE_PUBLISHABLE_KEY`.
3. Configure the web app's `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` using `apps/web/.env.example`. Only the publishable key belongs in the browser; never use a service-role key.
4. Run `bun run --cwd apps/api dev` and `bun run --cwd apps/web dev`. Open `/focus`, create a Supabase account, and start a session.
5. Open **Connect your CLI** in the session and follow [the Codex adapter setup](../integrations/codex/README.md). Creating a new capture token replaces the previous one; tokens expire after 24 hours and can be revoked immediately.

For hosted Auth, configure the web `/focus` URL in the Supabase Auth redirect allowlist and follow email confirmation when enabled. No hosted migrations or settings are changed by this implementation.

## Capture and recaps

The Codex adapter queues selected events locally and uploads them with a token restricted to one focus session. That token cannot read history, edit a recap, or operate the timer. The default capture contains tool names/result classifications and turn-completion markers. It never reads transcripts or sends raw command arguments, command output, prompts, or absolute paths. Assistant-message excerpts require a separate explicit opt-in; the adapter's redaction is best effort, so this option is a deliberate content-sharing choice.

The first recap is deterministic: it combines manual notes, agent-reported turn summaries, and tool-event counts. It does not invoke an LLM or claim that tool execution proves the user shipped something. Edited recaps stay separate from the evidence and survive subsequent hook uploads. Evidence remains visible with its source and optional HTTPS link.

Fifteen-minute sections use actual accumulated timer-running intervals, excluding pauses. They locate observations without assuming the gaps represent continuous work. Events during pauses and notes after completion remain in the evidence list, without being assigned focused time. Overlapping sessions keep their own durations; this slice does not provide a deduplicated daily total.

## Bounds and rollout limits

- Session lists return the latest 100 sessions. A future history view needs pagination.
- Sessions accept at most 2,000 evidence events; batches contain at most 50. Per-event rejections do not block valid events in the same batch. The adapter preserves rejected originals locally in quarantine with their reason; it never silently retargets them to a different session.
- Recap sections show at most seven days of focused time and explicitly disclose truncation. Stored timer duration is retained.
- New offline session starts must be within the preceding seven days. Event clocks more than five minutes ahead of the server are rejected; conflicting/backward timer transitions remain pending for review.
- The web timer outbox preserves original command IDs/timestamps and retries after reconnect. Private browsing/storage failure cannot provide durable offline storage.
- Manual note and recap drafts remain in the open editor on request failure; they are not part of the durable timer-command outbox.
- The standalone hook must be configured for the intended focus session. There is no automatic project-to-session matching, hosted MCP server, GitHub/Linear connector, Accessibility collector, or screen recording in this slice.
- Existing macOS/mobile realtime clients require a separate authenticated session migration before they can control these sessions.

## Verification

Fast checks:

```sh
bun run test:fast
bun run --cwd apps/api typecheck
bun run --cwd apps/web typecheck
bun run --cwd apps/web build
bun run --cwd packages/database db:check
```

Rollback-only database behavior tests, with local Supabase running and migrations applied:

```sh
bun run test:focus:db:local
```

The existing `supabase/tests/app_schema_test.sql` verifies automatic profile creation, cascade deletion, and private-schema access. The HTTP smoke helper in `apps/api/test/focus-http.smoke.mjs` additionally exercises real Supabase signup/JWTs, mounted oRPC paths, status codes, token scope, hook delivery, and persistence across a Node API restart against local services only.

See [verification workflows](verification.md) for narrower commands, separate builds/HTTP smoke, and the physical-device acceptance boundary. The named local database command never inherits a hosted database URL and fails rather than skipping when the local stack is unavailable.
