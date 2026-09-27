# Wellspent: current plan

Updated September 17, 2026. **Read this first to choose work.** This file owns current priority, status and the next handoff. Detailed acceptance criteria live in the linked execution plan; dated evidence stays in its original document. Historical “start here” prompts do not override this queue.

## September 17 architecture sprint — requirements being resolved

The user selected **resolving the hardest architecture decisions and proving them with small working experiments** as the outcome through September 20. This planning sprint takes priority over automatically starting the C4 feature handoff below. C4 remains unfinished; this does not reopen completed C3b/C4a work or establish any new acceptance.

**Walkthrough:** [visual system design](design/2026-09-17-wellspent-system-design.md), [rendered diagrams](design/2026-09-17-wellspent-system-design.html), and [architecture documentation index](design/README.md). The September 17 review produced seven validated diagrams, current-source ownership and an ordered experiment proposal. No Rust/vault implementation was added. Frontload the portable Rust protocol/durability experiment and a native binding smoke alongside evidence attribution; complete the relevant trust/record decisions before treating any experimental wire format as production.

The [documentation app](../apps/docs/README.md) now presents these canonical sources through Fumadocs. Run `bun run dev:docs` for the architecture, plan, package guides, integration guides and generated native HTTP reference. Documentation delivery does not establish new product or security acceptance.

Confirmed direction:

- Mac-first usefulness together with a future independently writable cross-device product. Exact first phone capabilities and web participation remain open.
- Distribution target: **Mac App Store and signed direct download**, with app stores preferred on supported platforms where feasible. This does not yet promise identical capabilities or simultaneous releases. Frontload [sandbox-compatible helper packaging](design/2026-09-17-wellspent-system-design.md#distribution-target-and-helper-feasibility) alongside the Rust binding experiment; store approval remains unproven.
- The first workflow is **Codex in the terminal**, where the user currently does most work. Observe the existing workflow by default; requiring Wellspent to launch or own agent sessions is not selected. Authentication mode remains unspecified. Claude Code/OpenRouter adapters are not required for the first experiment.
- Context switching must cover **both project/task changes and application changes**, including work that changes within the same terminal application. Project/repository identity is useful evidence but does not alone establish task identity; attribution needs explicit links or labelled, correctable inference.
- GitHub is the next desired integration. Feedback must cover **both recurring review findings/rework and time/model usage from starting work through an accepted PR, with evidence attached and no single productivity score**. Keep observed review outcomes separate from inferred quality or causal claims about model choice. Identity links between work and PRs, the definition of accepted, and treatment of waiting time/parallel work remain to be decided. The user also considers OpenAI a valid external integration if helpful; first establish what it adds beyond local Codex telemetry. No account-level usage/history capability is assumed, and no live integration access has been exercised.
- Show model identity and reasoning configuration during work; collect token usage where a reliable source exists. Treat reasoning effort, usage, estimated cost, actual billing and subscription allowance as separate concepts. Available telemetry and its correlation to ordinary terminal sessions still need a selected-workflow proof.
- The user wants all three content capabilities considered: minimal metadata/explicit notes, richer local context with opt-in, and useful behavior without hosted disclosure. They are open to local and hosted reasoning and a memory solution such as Plastic Labs/Honcho that can interoperate with Codex, Hermes or other agents. The broader goal is understanding how effectively people use these tools. Exact offline-AI acceptance remains unspecified; openness to both modes is not a verified local-inference requirement or capability.
- **Hosted disclosure routing: direct device-to-provider is the default; selected plaintext through Wellspent's backend is an optional premium feature.** E2EE sync remains independent of either route. Premium entitlement is not disclosure consent: the proposed enforcement contract grants access only to selected content/purpose/recipient, never vault keys or implicit whole-history access. Persistence, retention/deletion, provider credentials and background execution remain open. This product direction does not authorize reading transcripts, enabling richer collection, installing memory integrations or uploading private content during this sprint.
- Evaluate an optional memory adapter while Wellspent retains original evidence, task/run/PR links, corrections and disclosure authority. **The first memory experiment shows findings to the user; feedback into agents comes later.** Findings must expose supporting evidence, uncertainty and correction controls. Agent context injection, retrieval of these lessons and automatic behavior changes are outside the first experiment. See [memory architecture candidate and experiment](design/2026-09-12-wellspent-local-first-architecture.md#september-17-memory-integration-candidate).
- **Wellspent servers being unable to decrypt synced personal records is a firm product requirement. Settle the encrypted-sync architecture during this sprint.** The current plaintext Focus/backend path and unencrypted local recording store do not meet a future encrypted-vault claim. Existing data must be preserved; migration scope, local encryption, disclosure exceptions and trust/recovery rules remain decisions.
- User-reported compute window: 54% of the current weekly allowance remains; reset September 19 at 04:40; the full reset expires September 20 at 22:00. Eastern timezone is assumed, not confirmed. Allowance percentages are not token or work-hour estimates; hands-on availability remains unspecified.

Resolve these questions before selecting materially branching implementation: permitted context detail and hosted-AI disclosure; reliable project/task/PR attribution within the existing terminal workflow; PR acceptance and time-accounting semantics; first replicated dataset; membership/revocation/recovery; phone/web roles; and shared replication ownership across native clients. Use the existing [research register](design/2026-09-12-wellspent-research-roadmap.md#blocking-decisions) for R01–R10/R14 rather than creating another roadmap. The [agent-spend discovery](design/2026-09-08-agent-spend-and-workflow-discovery.md) supplies earlier hypotheses, not current telemetry acceptance.

Candidate proofs, pending those decisions: one CLI run with model/effort/usage and provenance; one task spanning context switches and PR review; deterministic offline conflict/retry/restart fixtures; and three-device membership/revocation/recovery transcripts. Use synthetic data until a real-data experiment is specifically scoped. Each proof must name the decision it settles, observed failures and remaining unknowns. No provider adapter, telemetry activation, encrypted-sync prototype or GitHub access was executed by this planning update.

## Outcome and current position

Record ordinary work on the Mac, stop, inspect application and agent activity with visible gaps, and know where to resume. New detailed observations stay local unless explicitly selected for disclosure.

**C4a is implemented and the user reports it complete as of September 16; individual live results and build identity remain unspecified. The September 16 recording UI follow-up moves history into Settings and shows newest activity first. The following C4 engineering slice is append-only annotations/corrections.** See [C4a implementation and acceptance](design/2026-09-14-c4a-local-log-work.md). C3b's selected live capture/restart check passed in the running Debug app: real PostToolUse and Stop events remained pending while the helper stopped and Timer paused, recovered after a verified helper process restart, committed exactly once with original body/time, received ACKs and appeared in Timer. See [C3b evidence](design/2026-09-13-c3b-local-codex-intake.md). Do not repeat basic pairing, Stop or pending-restart setup. Signed distribution, full pairing UI/keyboard behavior and C2 formal evidence remain separate acceptance work.

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
| Session timeline (Task 4) | C4 in progress; C4a completion user-reported | The deterministic timeline groups immutable events by interval with explicit gaps. C4a adds the local AI Harness connection and separately labelled `log_work` notes. Individual C4a acceptance results remain unspecified; append-only annotations/corrections remain; see [C4a evidence](design/2026-09-14-c4a-local-log-work.md). |
| Local MCP/Effect maintenance | All three slices implemented in the working tree | [MCP/Effect evidence](design/2026-09-26-wellspent-mcp-effect-plan.md#slice-3-implementation-evidence--september-26-2026): SDK-owned stdio and immutable binding; Effect Schema, injected services and typed failures; cancellation with durable bookkeeping, shared timeout policy, shutdown cleanup and opt-in privacy-safe stderr tracing. Domain tests pass 37/37 and owning harness tests pass 61/61, including standalone Node bundles; typecheck and scoped Biome pass. Live Codex/native-app compatibility remains unverified. No implementation slices remain in this maintenance plan; C4 remains the product priority. |
| Grounded recap and usefulness (Task 5) | Pending | Selected-input disclosure, persisted recap references and real-use evaluation remain C5. Existing Focus recap does not establish this capture recap. |

## Ordered work

September 16 session-reuse follow-up: timer Start/Resume/Pause already controls
foreground capture and active local note admission. An unchanged connection repair
now preserves MCP discovery instead of prompting another session restart. See
[session reuse and evidence](design/2026-09-16-codex-session-reuse.md). Automatic
metadata grants remain interval-bound; the user's exact restart trigger is still
unconfirmed.

September 16 UI follow-up: the user reports C4a complete (individual acceptance
results and build identity were not supplied) and requested recording UI improvements
before annotations/corrections. Local Recordings now lives in Settings, with a
larger timeline area, secondary connection/sample controls, and newest-first
ordering. See [UI changes and verification](design/2026-09-16-recordings-settings-ui.md).
The next engineering slice remains append-only annotations/corrections; do not
restart C4a acceptance solely because its older detailed checklist remains open.

September 14 timer-control follow-up: the user requested coupling the Mac timer
buttons to local capture. Main-window and floating-widget Start/Resume now create
or resume a foreground recording, and Pause excludes new capture immediately,
including during an in-flight save. Recording startup must save before the timer
starts. Reset preserves recording history; remote state and app startup do not
authorize capture. Recording data remains local and separate from shared timer
sync. See [implementation and acceptance](design/2026-09-14-timer-recording-wiring.md).
The user subsequently reported C4a complete; append-only corrections remain
the next C4 engineering slice after the requested recording UI follow-up.

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

Status: **in progress; first deterministic timeline slice completed September 14, 2026**. `RecordingTimeline` groups immutable events by their established interval and orders them by source-reported occurrence, hook receipt, or native receipt, with save order as a deterministic tie-breaker. `RecordingReviewContent` now shows interval boundaries, source labels, empty intervals, known/unknown coverage gaps, and the distinction between an agent hook time and native save time. It does not add durations together as human time, mutate recordings, alter intake, or infer completion. Full combined real-work acceptance still needs C2's formal evidence and the signed distribution checks; implementation can proceed now.

Extend the existing review with application intervals, real agent events, user-authored notes and corrections that preserve originals. Make ordering, source, uncertainty and missing coverage understandable. Do not add foreground and agent durations together as human time. Done when a selected recorded session can be reconstructed manually and keyboard/native UI checks pass. See [Task 4](design/2026-09-12-wellspent-workflow-capture-plan.md#task-4--make-the-timeline-inspectable).

#### C4 first timeline slice — September 14, 2026

- **Changed:** `RecordingTimeline` and focused tests; `RecordingReviewContent` now renders interval-scoped timeline sections with explicit time basis, coverage and gap labels. Capture, SQLite schema/data, Codex pairings, helper queues, backend contracts and dependencies were untouched.
- **Passed:** `bun run --cwd apps/macos lint`, `git diff --check`, and `bun run --cwd apps/macos test` on the local macOS Xcode target. The suite includes the existing rendered `RecordingWindowTests` fixture and the new deterministic ordering, known-gap, unknown-interruption and empty-interval projection tests.
- **Evidence boundary:** the Debug build and automated native test/render pass establish compilation and deterministic projection behavior. They do not establish keyboard traversal, VoiceOver, visual suitability in the running app, signed distribution, C2 formal acceptance, or a user-authored note/correction flow.
- **Following bounded C4 step:** append-only annotations/corrections. C4a below implements the explicit local note connection; its live acceptance remains separate.

#### C4a — Connect `log_work` from the Wellspent UI

Status: **implemented; development startup repair verified; completion reported by user September 16, individual live/native results unspecified**. [Implementation, contract and acceptance checklist](design/2026-09-14-c4a-local-log-work.md). The AI Harness controls, private local MCP adapter, active-interval admission, durable retry, revocation and separate timeline note semantics are implemented. After the user's signed-app Connect failure, `b dev` now owns development setup/server lifecycle outside App Sandbox and supplies Node's PATH. Native tests passed (231 tests / 332 executions), including the real dev-runner handoff and Node-to-SQLite commit/ACK transport; capture tests and focused lint passed. September 16 live verification established an already-connected real Codex tool call, exactly one SQLite/timeline note across exact retry, finished/paused-state rejection that remains rejected after recording resumes, original acknowledgement after dev restart, and Disconnect rejection with prior evidence preserved. Dev was restarted and Xcode rebuilt/relaunched the sandboxed ad-hoc Debug app. Native automation then disconnected; fresh Connect/discovery and remaining lifecycle/keyboard checks are still pending. See the dated acceptance evidence in the checklist. Default: **GPT-6 Astra / High** for the first end-to-end slice because it crosses native UI, the local Node MCP adapter, Codex configuration, recording-scoped authorization, restart behavior and revocation. After that contract and acceptance fixture are stable, bounded SwiftUI polish may use GPT-5.6 Terra / Medium.

Add an **AI Harness** section beside the native recording/Codex controls with a one-time **Connect Codex** flow. Reuse C3's authenticated loopback transport, stable identities, private local storage and recording/interval association. Expose an MCP `log_work` tool that appends an explicit user/agent-reported note only to the active local Wellspent recording interval. Do not route this local path through the session-independent hosted work-log, require `api.wellspent.day`, create a cloud work-log token, upload observations or place a credential in the repository or global Codex configuration.

- The UI owns connection status, explicit installation approval, revocation and recovery guidance. It may invoke the supported local `codex mcp add` command only after the user chooses Connect; show **Restart Codex required** until a new session discovers the tool. Never claim that an already-running session gained a tool.
- `log_work` must return a clear non-success result when no recording interval is active, including paused, suspended, interrupted and finished states. It must never start or resume a recording automatically, guess an interval from time overlap or admit skipped work later.
- Preserve C3's commit-before-ACK, stable-ID retry, account/local-scope isolation and original timestamps. A retry after helper/app restart must commit once. Revocation must prevent new calls without deleting prior evidence.
- Keep explicit semantic `log_work` notes separate from optional automatic PostToolUse/Stop metadata hooks. Connecting the MCP does not silently enable hooks, transcript reads, prompts, arguments, tool output, paths or assistant prose.
- **Done when:** a real `log_work` call from a newly started Codex session appears exactly once in the active local recording and timeline; inactive-state calls are visibly not logged; helper/app restart and retry preserve identity; disconnect/revoke blocks later calls; the UI communicates connection/restart/error states and passes focused domain/transport tests plus keyboard/native UI acceptance. Signed distribution remains a separate evidence gate.

### C5 — Add a grounded recap and evaluate real work

Status: **depends on C4**. Default: Astra / High for evaluation.

Let the user select evidence for model disclosure; save input references and recap separately. Cite event IDs and preserve uncertainty. Check complete, sparse, contradictory and failed-run fixtures, then a selected real session. Done when the user can accurately answer what happened, what remains unresolved and where to resume; record corrections, evidence gaps and usage/latency. See [Task 5](design/2026-09-12-wellspent-workflow-capture-plan.md#task-5--reason-from-evidence-and-try-it-during-real-work). Fix recurring capture gaps before adding integrations.

## Supporting work and deferred work

**September 26 macOS architecture cleanup:** [steps 1, 2, and 5](design/2026-09-26-macos-architecture-cleanup.md#implementation-evidence--september-26-2026) are complete: Recording domain/contracts now live in Model, the foreground adapter lives with Recording, and tests follow their owners. All 37 Swift moves preserve file contents; the crash harness source paths were updated. Lint, unsigned build, all 278 native tests (zero failures/skips), the standalone Model typecheck, and both synthetic crash harnesses passed. [Step 3: extract RecordingTaskModel](design/2026-09-26-macos-architecture-cleanup.md#step-3--split-recordingmodel-implemented) is now implemented in the working tree: task state/commands use the recording operation queue, with retries, scope isolation and quit protection preserved. See the [step 3 evidence](design/2026-09-26-macos-architecture-cleanup.md#step-3-evidence--september-26-2026) for its separate checks and native UI boundary. The next optional maintenance slice is removing the unused Settings material wrapper after rechecking callers; C4 acceptance remains the product priority. Steps 4 and 6 remain deferred; this maintenance does not change the C4 priority or establish live/manual acceptance.

The [macOS audit](design/2026-09-12-macos-interface-and-architecture-audit.md) retains Focus load/error recovery, unsaved Focus quit protection, Settings/stopwatch terminology, shared contract fixtures/DTOs, and fixture previews/UI smoke checks. These findings need current-source revalidation before selection. Recording's save/quit guard does not establish protection for unsaved Focus drafts. Pick a supporting fix when it blocks this loop or as an explicitly selected maintenance task; do not repeat the completed composition extraction.

The [research register](design/2026-09-12-wellspent-research-roadmap.md) owns private-record migration, membership/revocation/recovery, web participation, convergence, native bindings/crypto, disclosure/runtime isolation, provider access, backup and portability. **September 17 promotes encrypted architecture and a bounded portable Rust experiment into the active sprint.** R01–R05 still gate production encrypted-sync decisions; synthetic hypothesis tests and a non-sensitive binding smoke can proceed with assumptions labelled. See the [experiment order and Rust handoff](design/2026-09-17-wellspent-system-design.md#8-build-order-and-the-compute-window). Calendar/Linear automation, production phone replication/relay rollout and a new agent runtime remain later work. The [August checkpoint](design/2026-08-29-focus-timer-product-and-sync-architecture.md#26-recommended-next-implementation-sequence) retains historical browser recovery and Android follow-through, subject to the new ownership/migration decisions.

## Document ownership

| Document | Read it for |
| --- | --- |
| This file | Current status, priority, dependencies and next task. Update this when work advances. |
| [Visual system design](design/2026-09-17-wellspent-system-design.md) and [documentation index](design/README.md) | Current versus target architecture, portable Rust boundaries, experiment dependencies and a guided review of the design corpus. |
| [Workflow-capture execution plan](design/2026-09-12-wellspent-workflow-capture-plan.md) | Milestone scope, detailed Tasks 1–5 acceptance and historical evidence. |
| [Local-first architecture](design/2026-09-12-wellspent-local-first-architecture.md) | Accepted product/device roles and future ownership; not the active task queue. |
| [macOS audit](design/2026-09-12-macos-interface-and-architecture-audit.md) | Supporting findings and extraction evidence; historical recommendations require revalidation. |
| [Research roadmap](design/2026-09-12-wellspent-research-roadmap.md) | Stable decision IDs and research gates; current sprint selection lives here in the plan. |
| [Signal matrix](design/2026-09-12-wellspent-capture-signal-matrix.md), [synthetic proof](design/2026-09-12-macos-synthetic-recording-proof.md), [SQLiteData note](design/2026-09-13-macos-sqlitedata.md) | Capability limits, accepted recording policy and dated implementation/acceptance evidence. |

## Next-session prompt

Current session: walk through the [visual system design](design/2026-09-17-wellspent-system-design.md), especially the Rust boundary and decision table. Next bounded architecture work is the Gate 0/1 record/trust contract and A/B/C adversarial fixtures, with a non-sensitive Rust binding smoke available independently. Use its [Rust handoff](design/2026-09-17-wellspent-system-design.md#first-rust-handoff) to prepare the durable synthetic proof. Do not automatically execute the earlier feature prompt below while this sprint is active.

Retained feature handoff after the architecture sprint: **Wellspent — C4 append-only annotations/corrections**, subject to the resulting decisions.
The user reports C4a complete; detailed live check results and build identity remain
unspecified. Do not repeat setup by default. The September 16 Settings/timeline UI
follow-up precedes this slice. C2 formal and signed distribution evidence remain separate.

```text
Read AGENTS.md, docs/WELLSPENT_PLAN.md and the Task 4 execution criteria. Implement
append-only user annotations/corrections in the local recording review, preserving
original observations and their identity/time. Build on the Settings recording
workspace and newest-first timeline. Preserve recordings, grants, queues and dirty
changes. Verify persistence and native UI behavior with focused checks and record
their evidence limits. Keep C5 recap generation outside this slice.
```

## Keeping the plan current

At task close, update the relevant row and task status here; name the next ready ID. Link a dated evidence entry containing source/commit or working-tree scope, changed files, checks and pass/fail/unrun results, environment and remaining gates. Keep implementation and acceptance separate. Replace stale handoffs instead of appending another conflicting “next.” Do not make a new roadmap per session or mark a feature accepted from a build alone.
