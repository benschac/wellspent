---
name: verify-focus-sync
description: Verify Timer focus-session changes with its scoped behavior, capture, and local database checks. Use for focus persistence, replay, revision, or evidence-delivery acceptance; not for generic UI edits.
---

# Verify focus sync

Read `docs/verification.md` from the Timer repository root and select the checks that match the changed boundary. The current source map is in `AGENTS.md`; the architecture's section 6 distinguishes implemented focus behavior from the native WebSocket prototype.

- Run `bun run test:focus` for focus rules/browser persistence, `bun run test:capture` for hook delivery, or `bun run test:fast` when both apply.
- For repository/database changes, run `bun run test:focus:db:local` against the already running, migrated Timer stack. Do not substitute a hosted URL or automatically reset/migrate a database to make a check pass.
- Add the affected package's typecheck when code/contracts change. Use the separate HTTP smoke only when auth, mounted routes, or restart persistence need that evidence.
- Read actual results, including skipped tests. Report commands, pass/fail/skip, environment, and any remaining acceptance boundary. Storage doubles and synthetic hooks do not establish browser transaction durability or live harness delivery.

Do not expand a verification request into implementing missing sync features. When implementation is already requested, preserve that authorization and continue through its scoped acceptance criteria.
