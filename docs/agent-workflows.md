# Agent workflow and skill audit

Audited September 6, 2026. `AGENTS.md` is the short repository map; the architecture checkpoint owns current scope; `docs/verification.md` owns executable checks and proof boundaries. Keep task-specific procedures out of general working preferences.

## Project skills

- [verify-focus-sync](skills/verify-focus-sync/SKILL.md): selects focused commands and distinguishes unit, database, HTTP, and live-harness evidence.
- [run-native-acceptance](skills/run-native-acceptance/SKILL.md): selects native scenarios and records device evidence without conflating the prototype with durable sessions.

Both reuse package scripts and the verification guide. They add Timer-specific acceptance knowledge, not duplicate framework tutorials. Their descriptions intentionally exclude generic UI edits and ordinary native reviews.

The workspace's protected `.agents` directory was unwritable when these were added. The files therefore live under `docs/skills` and are routed explicitly from root `AGENTS.md`; they are not automatically catalog-discovered skills. A future installation can place them in a supported skill directory, but should retain one maintained copy and the shared verification guide.

## Installed overlap findings

This was a targeted audit of relevant installed entrypoints and their differences, not a review of every installed skill or referenced guide. Paths below are relative to the user's home; versions/content may change after installation updates.

| Family | Observed overlap | Selection for Timer |
| --- | --- | --- |
| Turborepo | `.agents/skills/turborepo` reports 2.10.11; `.codex/skills/turborepo` reports 2.9.7-canary.13. Guidance differs on root tasks and affected-base configuration. | Use the 2.10.11 entrypoint with the installed Turbo 2.10.12 source/schema; do not combine both copies. |
| Supabase | `.agents/skills/supabase` and the Supabase plugin's 1.0.0 entrypoint overlap but contain different security guidance. | Select one relevant entrypoint and verify consequential claims against current official docs/source. Timer's Drizzle-generation/Supabase-application ownership remains the project rule; generic live-schema mutation recipes do not replace it. |
| Swift concurrency and testing | `.codex/skills/swift-concurrency-pro` and `swift-testing-pro` each contain a second entrypoint under `skills/<same-name>`. Nested copies reference `${CLAUDE_SKILL_DIR}`; top-level copies use relative references. | Use top-level Codex-compatible entrypoints; avoid loading both. |
| SwiftUI | Top-level `.codex/skills/swiftui-pro` reports 1.1; nested `skills/swiftui-pro` reports 1.0 and uses `${CLAUDE_SKILL_DIR}` references. | Prefer the top-level entrypoint for SwiftUI work. |
| Expo development client / React Native performance | Available descriptions cover building/distributing clients and performance diagnosis, respectively. Neither describes Timer's session/replay acceptance workflow. | Use those skills when their specific work is needed; the project native skill supplies the missing acceptance boundary. |

Shared installations were not changed: these copies may belong to other projects or plugin packaging. This repository narrows selection and records conflicts; it does not claim global deduplication or removal from the skill catalog. Future shared cleanup should be a separate scoped installation change.

## Outcome-sized task handoffs

Give the task an observable outcome, owning paths, behavior to preserve, acceptance evidence, and explicit deferred work. Section 26 of the architecture contains the next implementation tasks. For example:

> Implement IndexedDB persistence for `/focus` behind the repository boundary. Preserve existing account-scoped queued commands, IDs, timestamps, revisions, and cached sessions. Demonstrate restartable migration, interrupted writes, multi-tab acknowledgement, offline reopen, and replay without duplicate transitions. Keep rejected work inspectable and unrelated sessions syncing. Run the focused checks and a real browser recovery scenario; report what each proves. Device registration and native UI are separate tasks.

Use routine implementation judgment within that scope. Mark stale progress notes when behavior changes, and record unrun acceptance checks explicitly rather than making a test count stand in for product proof.
