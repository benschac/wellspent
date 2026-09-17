# macOS synthetic recording durability proof

Historical evidence for the synthetic slice. The [current plan](../WELLSPENT_PLAN.md) owns next work. Foreground collection was subsequently implemented, and [SQLiteData/GRDB](2026-09-13-macos-sqlitedata.md) supersedes the custom connection/executor described below. Preserve this run's evidence boundaries; its “next task” text is no longer the current handoff.

Date: September 12, 2026. Baseline: `0b33e7b` plus the scoped implementation below. Status: **synthetic-storage slice complete**, including user-run persistence/restart acceptance corroborated by read-only SQLite queries. Real collection remains disabled and the broader Task 2 live-capture gates remain open.

## Try the slice

In the newly built macOS app, choose **Recording preview…** from the menu bar. Start a sample recording, add sample application/agent/note events, pause or simulate a gap, explicitly resume, then finish. Closing the window preserves the same model and repository. Reopening the app restores unfinished work as interrupted and requires explicit Resume.

The preview uses fixed synthetic text. It has no OS collectors, hooks, permission prompts, account requirement, HTTP client, or upload path. It does not inspect ordinary work. The existing running user app was not quit or replaced to perform acceptance.

## Owners and guarantees

- `Features/Recording/RecordingEvent.swift` and `RecordingSnapshot.swift` define immutable event, local workspace, recording and interval identity; timestamp basis; process-tagged monotonic stamps; and deterministic reconstruction. Source/provenance labels derive from the synthetic event kind. Optional cloud Focus association is immutable start metadata, not recording authority. Real harness correlation fields/intake remain Task 3 work.
- `Services/Recording/SQLiteRecordingRepository.swift` owns one SQLite connection on a dedicated serial executor. It uses bound values, foreign keys, rollback journaling, `synchronous=EXTRA`, `fullfsync`, a 250 ms busy timeout, and versioned transactional migrations, following [SQLite synchronization guidance](https://www.sqlite.org/pragma.html#pragma_synchronous) and [transaction semantics](https://www.sqlite.org/lang_transaction.html).
- A recording row and first event commit atomically. Further boundaries/events are immutable rows with a unique event ID and per-recording commit sequence. Projections rebuild from committed events; there is no independently mutable projection. Identical replay is a no-op; conflicting content is rejected without replacing the original.
- `Features/Recording/RecordingModel.swift` owns synthetic intake authorization, one in-flight action, exact pending-event retry and recovery. Storage failure disables intake. Retrying a failed start/observation restores it as interrupted, requiring Resume. Ordinary Quit drains the operation and is declined if a pending recording action cannot save; the preview exposes Retry. Forced termination can lose an uncommitted pending action, but cannot make it appear committed.
- App composition constructs one recorder; the window coordinator reuses its window. Opening the preview may load/migrate/reconcile history, but cannot create a recording or authorize collection. Pure review rendering performs no persistence or upload operations.

The default store is `Wellspent/SyntheticRecording/recordings.sqlite` within Application Support (inside the app container when sandboxed). Construction is inert; storage opens on first preview load. Existing Node spools, cloud Focus data and the stopwatch protocol are unchanged. This is an unencrypted preview store. Encryption remains deferred, not an implementation prerequisite. No retention eviction or automatic deletion was introduced.

Pause/finish excludes later receiver-time observations. A delayed synthetic agent report requires explicit original recording/interval association, source-reported time and a known closed interval containing that time; ambiguous/interrupted coverage is rejected. The future intake adapter must establish trust before supplying source-reported time. Review preserves save order and displays receipt/source times separately in UTC. Duration uses matching-process monotonic endpoints; unknown interruption ends stay unknown. These are not human-focus measurements.

The preview serializes controls while saving. Repository race tests establish that an observation racing Pause either commits before it or is rejected; they do not establish real collector cancellation. Synthetic suspension requires Resume. The confirmed policy allowing resumption after a verified return remains a live-collector task.

## Executed verification

Environment: macOS 26.3 (25D125), arm64, Apple Swift 6.3.3. The existing target remains Swift 6 with complete concurrency checking and minimum macOS 14. No dependency, entitlement, backend write or persistent personal capture activation was added.

| Check | Evidence |
| --- | --- |
| Full native compilation/tests | `bun run --cwd apps/macos test` passed with zero failures/skips. Result: `apps/macos/.derivedData/Logs/Test/Test-TimerMac-2026.09.12_17-46-10--0400.xcresult`. Includes existing Focus/auth/retry, stopwatch, widget/geometry and window tests. |
| Domain/repository | Lifecycle/reopen/rebuild, exact/conflicting replay, out-of-order timestamps, stale scope/generation, delayed reports, unknown interruption ends, same-process Resume overlap, atomic migration/event rollback, and lost acknowledgements passed. |
| Storage failures | Actual `SQLITE_FULL` with a page-limited disposable database; actual `SQLITE_BUSY` under a competing write lock; unwritable, missing, corrupt and unsupported stores passed without replacing previous history. These are SQLite/filesystem checks, not hardware power-loss certification. |
| Model lifecycle | Held-commit shutdown drain, failed save/quit refusal, stable retry identity, no silent retry/restart resumption, real SQLite/model restart, scope-switch restrictions and inert load passed. |
| Process termination | `bun run --cwd apps/macos test:recording:crash` passed four subprocess cases: before event writes, after event writes before COMMIT, after COMMIT before acknowledgement, and during migration. Each helper dies by SIGKILL; a new process checks exact committed history. The runner compiles production repository/domain sources and removes only its unique temporary helper/database directory. |
| Window and visual check | Hosted window/model reuse and shutdown passed. After extracting read-only review content for rendering, the focused window suite passed again: `Test-TimerMac-2026.09.12_17-48-13--0400.xcresult`. Controls/review fixture image was inspected: suspended state, disabled intake, distinct sources, gap text and UTC timestamps are readable. Native List/ScrollView bitmap capture was incomplete and was not counted as full-window visual proof. |
| Lint/whitespace | Strict native Swift lint and `git diff --check` passed. |

Initial compilation caught migration-closure isolation and ambiguous fault-injection labels; both were fixed before passing runs. Review identified same-process Resume overlap; a regression covers the fix. The Swift concurrency and Swift Testing skills informed the dedicated executor and deterministic held-operation tests.

## Remaining acceptance and next task

### Manual acceptance completed

The user also confirmed exercising **Simulate coverage gap**. The previously inspected SQLite history contains `suspend` followed by `resume` with a new interval ID. This completes the synthetic coverage-gap check; it does not establish actual OS sleep/lock handling. The synthetic-storage task remains **complete**. Real application observations and OS lifecycle handling are the next implementation task, with no further synthetic UI steps required from the user.

The user created sample recordings, inspected their event rows in TablePlus, and confirmed that events remained after reopening Timer. Read-only queries of the app-container SQLite store corroborated an ordinary shutdown/restart sequence on September 12: start and note, an `interrupt` boundary at 22:10:16 UTC with reason “App closed — explicit Resume required; final coverage unknown,” then `resume` at 22:11:00 UTC with a different process marker and a new interval ID. Subsequent sample events and `finish` were committed. This establishes ordinary app shutdown/restart persistence and explicit resumption, not just window reuse. No stored data was modified during verification. Exact recording/process identifiers and user content are omitted here.

Next is the live Mac application-activity slice of Task 2: settle retention/deletion/disclosure, verify lock/sleep/session/permission transitions on the intended signed build, then connect foreground application identity/transitions through the existing repository. Verify pause/finish suppression and visible coverage gaps using deliberately selected activity. Encryption remains deferred. The synthetic proof does not establish minimum-OS distribution, hardware power loss, full-window keyboard/VoiceOver acceptance, or ordinary agent-hook intake. Task 3 still needs a sandbox-compatible trusted intake bridge after that.

The repository reconstructs the small synthetic history per operation. Pagination and performance work should follow a measured live-data requirement. This is not a replica engine, cloud Focus migration, encrypted sync system or the full Task 4 timeline. Existing unrelated and concurrent planning/integration changes were preserved.
