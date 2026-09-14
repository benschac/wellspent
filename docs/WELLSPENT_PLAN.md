# Wellspent: current plan

Updated September 13, 2026. **Read this first to choose work.** This file owns current priority, status and the next handoff. Detailed acceptance criteria live in the linked execution plan; dated evidence stays in its original document. Historical “start here” prompts do not override this queue.

## Outcome and current position

Record ordinary work on the Mac, stop, inspect application and agent activity with visible gaps, and know where to resume. New detailed observations stay local unless explicitly selected for disclosure.

**Next engineering task: C4 — make the combined timeline useful without AI. C3b's selected live capture/restart check passed in the running Debug app.** Real PostToolUse and Stop events remained pending while the helper stopped and Timer paused, then recovered after a verified helper process restart. Each committed exactly once with its original body/time, received an ACK and appeared in Timer. Synthetic duplicate/crash tests also passed; see [C3b evidence](design/2026-09-13-c3b-local-codex-intake.md). Do not repeat basic pairing, Stop or pending-restart setup. Signed distribution, full pairing UI/keyboard behavior and C2 formal evidence remain separate acceptance work.

The user reported completing C2's manual checklist on September 13, without build/signing identity or individual results, so formal C2 acceptance remains open. [C3a](design/2026-09-13-c3a-local-codex-intake.md) remains the settled contract. Do not repeat C2, restart discovery/storage work, or treat synthetic checks as ordinary-session acceptance.

Latest C3b recovery: the debugging thread initially had no matching grant; the
previous grant targeted another thread and a closed interval. The user's new
native pairing then hit a clipboard JSON import failure. Its exact saved bundle
was transferred privately to the helper, preserving old pairings. Real delivery
through interval closure and the visible report is now verified. Minimal private
metadata diagnostics and 16 passing helper tests support future diagnosis. The
earlier zero-count failure's hook identity/result is still historically unproven.
See the [recovery evidence](design/2026-09-13-c3b-local-codex-intake.md#recovery-and-real-posttooluse-delivery--september-13-2026).

The reload follow-up confirmed saved reports remained. The subsequent guided
pending-event test additionally verified an accepted Stop and recovery of both
test events across helper PID `34848` → `44957`, with no duplicate saved rows.
See the [final live evidence](design/2026-09-13-c3b-local-codex-intake.md#pending-event-helper-restart-and-accepted-stop--september-13-2026).
Five unimported native grants slowed healthy intake through the global polling
backoff; pairing deduplication/status and independent retry scheduling are a
focused follow-up, not grounds to revoke existing grants automatically. A
deliberately lost ACK/duplicate replay remains synthetic-test evidence only.

| Area | Implementation | Acceptance / evidence |
| --- | --- | --- |
| Signal scope and recording policy (Task 1) | Complete | [Signal matrix](design/2026-09-12-wellspent-capture-signal-matrix.md): independent local recording, optional Focus link, explicit resume after interruption, minimal metadata. Live harness/distribution limits remain explicit. |
| App composition and window ownership | Complete | `TimerAppComposition` and `TimerWindowCoordinator`; [audit evidence](design/2026-09-12-macos-interface-and-architecture-audit.md#step-2-implementation-evidence--september-12-2026). Physical lifecycle/window acceptance remains open. |
| Local recording lifecycle and storage (Task 2) | Complete | [Synthetic proof](design/2026-09-12-macos-synthetic-recording-proof.md) records restart acceptance and failure tests. [SQLiteData migration](design/2026-09-13-macos-sqlitedata.md) records native/crash checks and supersedes the custom SQLite adapter. |
| Foreground application collector (Task 2) | Complete | Fixture tests recorded; user reports completing the manual checklist. [C2 follow-up](design/2026-09-12-wellspent-workflow-capture-plan.md#c2-user-acceptance-follow-up--september-13-2026) preserves unknown build/signing identity and individual results. |
| Ordinary agent activity (Task 3) | C3a and C3b complete for the selected live Debug workflow | [C3b evidence](design/2026-09-13-c3b-local-codex-intake.md): real PostToolUse/Stop pending across offline closure and helper restart, unchanged bodies, one row each, ACKs and visible reports. Signed distribution/full pairing UI acceptance remain separate. |
| Session timeline (Task 4) | Partial foundation | `RecordingReviewContent` displays committed events, source labels, intervals and gaps in save order. Full correlated timeline, real notes/corrections and native UI acceptance remain C4. |
| Grounded recap and usefulness (Task 5) | Pending | Selected-input disclosure, persisted recap references and real-use evaluation remain C5. Existing Focus recap does not establish this capture recap. |

## Ordered work

Stable IDs below subdivide the existing Tasks 2–5; they are not another competing roadmap. Complete one bounded task per session. Preserve existing behavior, dirty changes and committed recordings.

### C2 — Close live Mac acceptance

Status: **implementation complete; manual checklist completion reported by user; formal acceptance pending evidence details**. The user's September 13 reply was “done,” with no failures reported. Build/signing/sandbox/OS identity and per-check outcomes remain unspecified; do not turn this into independently verified passes. See [user follow-up](design/2026-09-12-wellspent-workflow-capture-plan.md#c2-user-acceptance-follow-up--september-13-2026), [Task 2 evidence](design/2026-09-12-wellspent-workflow-capture-plan.md#task-2-live-application-activity-implementation-evidence--september-12-2026) and [native acceptance procedure](skills/run-native-acceptance/SKILL.md). Continue with C4; request only missing evidence when closing C2, rather than restarting its checklist.

- Prepare the intended signed build and a selected non-sensitive scenario. Record build/signing/sandbox/OS identity; do not replace or quit a running app with pending user work.
- Exercise start → app switch → pause → excluded switches → explicit resume → actual sleep/session unavailability → explicit resume → finish. Check committed history, coverage gaps and suppression after pause/finish. Reopen and inspect; test review/delete confirmation with a disposable recording.
- Explain permission applicability: foreground-only capture requests no TCC grant. A fabricated denial test does not prove behavior for future Accessibility or Screen Recording collectors.
- Done when actual scenario results and outstanding distribution limits are recorded. Fix observed defects narrowly. If access/user action is missing, record the exact blocked check and proceed with the current engineering task; retain this acceptance gap.

### C3a — Prove the local agent intake contract

Status: **complete — September 13 synthetic contract/prototype proof**. [Contract and dated evidence](design/2026-09-13-c3a-local-codex-intake.md). That proof enabled no production receiver or live hook; C3b subsequently implemented and verified them. The bullets below retain C3a's completed acceptance scope.

- Inspect `integrations/codex/timer-capture.mjs`, `integrations/work-log`, `RecordingEvent`, `RecordingSnapshot`, and the [signal matrix](design/2026-09-12-wellspent-capture-signal-matrix.md). Recheck official harness behavior when selecting an interface.
- Specify one sandbox-compatible, local-only intake path: sender trust, explicit recording/interval association, occurrence versus receipt time, stable identity, acknowledgement after durable commit, and rejection of unknown/stale/out-of-scope input. Do not guess associations from overlapping timestamps.
- Use synthetic metadata to prove duplicate/retry, delayed delivery, interrupted intervals, receiver restart/offline, and invalid sender/association behavior. Preserve existing cloud work-log IDs/spools and content-sharing defaults.
- Done when a short contract and executable proof identify the chosen path, limitations and exact C3b implementation scope. Resolve materially branching access/distribution choices before implementing them. No real hook activation, transcript access, new dependency or broader permission is implied.

### C3b — Connect one ordinary Codex workflow

Status: **complete — implementation, synthetic verification and selected live Debug capture/restart acceptance passed September 13, 2026**. [Implementation and dated evidence](design/2026-09-13-c3b-local-codex-intake.md). The [C3a contract](design/2026-09-13-c3a-local-codex-intake.md#exact-c3b-handoff) is promoted into production. New events wait for a known interval end; interrupted coverage is excluded. The exact hook handlers remain authorized, installed and trusted. Real PostToolUse and Stop events survived a helper restart while pending and then appeared exactly once with ACKs. Signed distribution/full pairing UI proof stays separate; deliberately lost-ACK/duplicate injection was tested synthetically, not live. **Proceed to C4 implementation rather than repeating this selected live test.**

- Persist one correlated local agent event per stable identity across retry/crash; retain original times and distinguish reported results from verified completion. Unknown correlation stays visible; apply the agreed outside-session policy.
- Run focused capture and native tests. Activate only the reviewed hook/configuration needed for the selected live test when explicitly authorized; preserve existing configuration and queues.
- Done when the ordinary harness path is observed end to end into local recording history, including delayed/duplicate delivery evidence. Synthetic tests alone do not close this task. C2 remains required for the combined real-work claim.

### C4 — Make the combined timeline useful without AI

Status: **next engineering task; C3's event contract and selected live Debug workflow are established**. Full combined real-work acceptance still needs C2's formal evidence and the signed distribution checks; implementation can proceed now.

Extend the existing review with application intervals, real agent events, user-authored notes and corrections that preserve originals. Make ordering, source, uncertainty and missing coverage understandable. Do not add foreground and agent durations together as human time. Done when a selected recorded session can be reconstructed manually and keyboard/native UI checks pass. See [Task 4](design/2026-09-12-wellspent-workflow-capture-plan.md#task-4--make-the-timeline-inspectable).

### C5 — Add a grounded recap and evaluate real work

Status: **depends on C4**. Default: Astra / High for evaluation.

Let the user select evidence for model disclosure; save input references and recap separately. Cite event IDs and preserve uncertainty. Check complete, sparse, contradictory and failed-run fixtures, then a selected real session. Done when the user can accurately answer what happened, what remains unresolved and where to resume; record corrections, evidence gaps and usage/latency. See [Task 5](design/2026-09-12-wellspent-workflow-capture-plan.md#task-5--reason-from-evidence-and-try-it-during-real-work). Fix recurring capture gaps before adding integrations.

## Supporting work and deferred work

The [macOS audit](design/2026-09-12-macos-interface-and-architecture-audit.md) retains Focus load/error recovery, unsaved Focus quit protection, Settings/stopwatch terminology, shared contract fixtures/DTOs, and fixture previews/UI smoke checks. These findings need current-source revalidation before selection. Recording's save/quit guard does not establish protection for unsaved Focus drafts. Pick a supporting fix when it blocks this loop or as an explicitly selected maintenance task; do not repeat the completed composition extraction.

The [research register](design/2026-09-12-wellspent-research-roadmap.md) owns deferred questions: private-record migration, membership/revocation/recovery, web participation, convergence, native bindings/crypto, disclosure/runtime isolation, provider access, backup and portability. R01–R05 gate future encrypted sync, not local capture. Calendar/Linear, planning automation, phone replication, custom crypto/relay and a new agent runtime remain deferred. The [August checkpoint](design/2026-08-29-focus-timer-product-and-sync-architecture.md#26-recommended-next-implementation-sequence) retains browser recovery and Android follow-through; choose that track explicitly instead of treating it as the default next capture task.

## Document ownership

| Document | Read it for |
| --- | --- |
| This file | Current status, priority, dependencies and next task. Update this when work advances. |
| [Workflow-capture execution plan](design/2026-09-12-wellspent-workflow-capture-plan.md) | Milestone scope, detailed Tasks 1–5 acceptance and historical evidence. |
| [Local-first architecture](design/2026-09-12-wellspent-local-first-architecture.md) | Accepted product/device roles and future ownership; not the active task queue. |
| [macOS audit](design/2026-09-12-macos-interface-and-architecture-audit.md) | Supporting findings and extraction evidence; historical recommendations require revalidation. |
| [Research roadmap](design/2026-09-12-wellspent-research-roadmap.md) | Open decisions and experiments when a deferred track is selected. |
| [Signal matrix](design/2026-09-12-wellspent-capture-signal-matrix.md), [synthetic proof](design/2026-09-12-macos-synthetic-recording-proof.md), [SQLiteData note](design/2026-09-13-macos-sqlitedata.md) | Capability limits, accepted recording policy and dated implementation/acceptance evidence. |

## Next-session prompt

Suggested session: **Wellspent — useful combined timeline (C4)**. C3b's selected live Debug capture/restart check passed; C2 formal and signed distribution evidence remain separate.

```text
Read AGENTS.md, docs/WELLSPENT_PLAN.md, the Task 4 section of docs/design/2026-09-12-wellspent-workflow-capture-plan.md and the final live evidence in docs/design/2026-09-13-c3b-local-codex-intake.md. Implement one outcome-sized C4 improvement to RecordingReviewContent: make committed foreground-app intervals, real Codex events, notes/corrections, ordering, uncertainty and coverage gaps inspectable. Begin with current source and preserve existing recordings, grants, queues and dirty changes. Do not repeat C3b's completed real PostToolUse/Stop pending-restart check or infer human focused time/completion from agent metadata. No transcript reads, uploads, new permissions/dependencies or backend changes are implied. Use focused checks and native UI evidence appropriate to the chosen change. Keep C2 formal evidence, signed distribution and deliberately lost-ACK live testing distinct from the verified Debug workflow. Record the result and next bounded C4 step.
```

## Keeping the plan current

At task close, update the relevant row and task status here; name the next ready ID. Link a dated evidence entry containing source/commit or working-tree scope, changed files, checks and pass/fail/unrun results, environment and remaining gates. Keep implementation and acceptance separate. Replace stale handoffs instead of appending another conflicting “next.” Do not make a new roadmap per session or mark a feature accepted from a build alone.
