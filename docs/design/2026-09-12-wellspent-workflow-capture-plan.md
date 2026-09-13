# Wellspent workflow capture: execution plan

Date: September 12, 2026. Status: Task 1 complete and reverified at `0b33e7b`, preserving the three recorded product decisions. Task 2 has completed the synthetic-storage and live foreground-application implementation slices; selected real-use and signed-build acceptance remain open. The [signal matrix and Task 2 handoff](2026-09-12-wellspent-capture-signal-matrix.md) distinguish earlier signed-probe evidence from current source, documentation, host probe and synthetic checks. This pass activated no ordinary live Codex hook capture. Encryption, multi-device sync and external integrations remain deferred.

Workspace: `/Users/benjaminschachter/timer`.

Task 2 implementation follow-up: the [synthetic-storage slice is complete](2026-09-12-macos-synthetic-recording-proof.md), including automated failure/crash checks and user-run restart acceptance corroborated by read-only SQLite queries. This supersedes the Task 1 pass's pending-acceptance description above. Next is the live Mac application-activity slice; its lifecycle and real-data gates remain open.

## Outcome

Start a recording session, work normally on the Mac with an agent and several applications, stop, and inspect an accurate account of what happened and where to resume. The immediate value is obtaining useful workflow evidence that is otherwise difficult to retrieve.

This is the active plan for that outcome. It takes priority over the crypto-first and integration-first sequences in the [research roadmap](2026-09-12-wellspent-research-roadmap.md). The [architecture](2026-09-12-wellspent-local-first-architecture.md) and [security design](2026-09-12-wellspent-security-design.md) retain the longer-term privacy and independent-device direction. They do not require encrypted sync before this capture milestone.

## Agreed scope and boundaries

- Native Mac is the primary workspace and capture surface. Start with one agent harness, preferably the existing Codex adapter after verifying its actual coverage.
- Use the existing backend for deliberately submitted structured work records. Keep new detailed machine observations local initially; selecting data for model/backend use is an explicit boundary.
- Recording has visible start, pause and stop states. Bind collection to a deliberate session. Decide how this relates to the current authenticated focus session; do not treat the separate shared singleton stopwatch as account authorization.
- Observe the user's ordinary workflow where supported. Clearly identify any experiment that only observes executions launched by Wellspent.
- Preserve event identity, event time, delivery time, source, account/session association, missing-data reasons and retries. Observed facts, agent reports, user notes and model inferences remain distinguishable.
- Keep rich content collection configurable. Task 1 must establish the minimum useful detail before changing current metadata-only defaults. Permission availability does not itself authorize continuous collection or upload.
- Existing user changes, queues, native UI, authentication and integration behavior must survive. Do not add dependencies or broaden OS access without the applicable authorization.
- Calendar/Linear/other providers, scheduling, phone sync implementation, Rust crypto, custom encrypted relay, hardware identities, universal capture, team roles and a new hosted agent runtime are outside this milestone.

## Source ownership and current evidence

The following paths were inspected during the planning conversation. Recheck their current state at the start of work; the repository has extensive uncommitted changes.

| Owner | Responsibility / current boundary |
| --- | --- |
| `apps/macos/TimerMac` | Native app, recording/permission UI and future collectors/local timeline. Current entitlements declare App Sandbox and outgoing network access; granular activity collectors have not been established. |
| `apps/macos/TimerMac/Features/Focus/FocusModel.swift` | Authenticated focus UI, API calls and in-memory pending state. Do not mistake this for durable local observation storage. |
| `integrations/codex/timer-capture.mjs` | Existing agent-event capture and spool. Metadata is the default; richer assistant content has a separate opt-in. |
| `integrations/work-log` | Existing CLI/MCP log/list/flush/status, local delivery spool and tests. A local MCP process is not automatically a local personal database. |
| `packages/api-contract/src/work-log.ts` | Shared input/output contract. Extend only when a concrete captured field needs backend transport. |
| `packages/api-client/src/work-log.ts` | `createWorkLogClient`, shared authenticated transport. Native collection, provider SDKs and MCP server hosting belong elsewhere. |
| `apps/api/src/work-log` and `apps/api/src/focus` | Existing structured server persistence, account isolation and session behavior. These paths remain server-readable. |

Use [agent workflow discovery](2026-09-08-agent-spend-and-workflow-discovery.md) as an index of prior source questions, not current proof of runtime access. Read root `AGENTS.md` and applicable nested instructions before acting. For relevant work, use the Swift concurrency, SwiftUI, Swift Testing, OpenAI Docs, oRPC/Zod, or repository acceptance skills as applicable; read the actual selected skill before implementation.

## Models and reasoning

These are recommendations for the **development sessions**, not a decision about the model Wellspent will use to summarize user activity. The assignments are engineering judgment based on task complexity; no repository-specific model benchmark has been run.

| Task | Default model | Reasoning | Why / escalation |
| --- | --- | --- | --- |
| 1. Signal and permission discovery | GPT-6 Astra (`gpt-6-astra`) | High | Reconcile OS/harness documentation, sandbox/distribution constraints, actual evidence and privacy boundaries. |
| 2. Recording session and local durability | GPT-5.6 Terra (`gpt-5.6-terra`) | High | Focused Swift implementation with lifecycle/concurrency/transaction tests. Use Astra/high for an unresolved cross-process or persistence design question. |
| 3. Agent capture and timeline correlation | GPT-5.6 Terra | High | Scoped adapter/contracts work with retry, correlation and data-minimization requirements. Escalate ambiguous harness behavior to Astra/high. |
| 4. Inspectable timeline UI | GPT-5.6 Terra | Medium | Build a bounded UI against established state/data contracts. Use high if lifecycle or identity bugs emerge. |
| 5. Evidence-based recap and real-use acceptance | GPT-6 Astra | High | Evaluate grounding, contradictory/missing evidence and whether the product reconstructs real work usefully. Terra/high can implement a settled recap contract. |

The [macOS audit model/readiness table](2026-09-12-macos-interface-and-architecture-audit.md#6-models-readiness-and-first-coding-task) covers the supporting architecture and interface tasks. Its app/window ownership extraction uses **Terra/high** and can start now without settling recording semantics. Complete that bounded preparation before adding recorder services in Task 2; it preserves the existing UI and timer behavior. The audit's step numbers map to this plan explicitly and do not replace Tasks 1–5.

Use GPT-5.6 Luna/low only for optional mechanical follow-ups such as formatting an already verified evidence table. Do not use it to decide permission scope, classify uncertain evidence as fact, or design persistence. There is no need to switch models for every small edit; keep one owner for a task and switch at a task boundary. Avoid max/xhigh by default; increase effort only for a concrete unresolved problem.

Official documentation checked September 12 describes Astra as the complex reasoning/coding option and Terra as balancing intelligence and cost. Both document high reasoning; Terra also supports medium. Account availability and UI choices must be checked in the new session. Sources: [model overview](https://developers.openai.com/api/docs/models), [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

## Task 1 — Demonstrate the available signals

Status: complete; independent local recording, suspension with explicit resume after restart, and the minimal signal set remain as recorded in [the signal matrix](2026-09-12-wellspent-capture-signal-matrix.md#4-confirmed-product-decisions). Default: Astra/high. Earlier sandboxed-probe evidence is retained; current host-access foreground/idle checks and 29 capture tests passed. Transition behavior and ordinary live hook delivery remain untested. See [current verification](2026-09-12-wellspent-capture-signal-matrix.md#8-current-verification-pass--september-12-2026).

Inspect current native app signing/sandbox settings, the two timer/session paths, capture adapters, MCP tools and local persistence. Identify installed OS/harness versions without reading unrelated private transcripts or credentials. Search current official Apple and harness documentation for the exact APIs under consideration. Distinguish documented, source-inspected, observed, unavailable and untested capabilities.

Create `docs/design/2026-09-12-wellspent-capture-signal-matrix.md` with these columns:

| Signal | Source/API | Permission and distribution constraints | Detail available | Existing workflow or launched-only | Local retention / disclosure | Evidence and limitations |
| --- | --- | --- | --- | --- | --- | --- |
| Foreground application | To investigate | To investigate | To verify | To verify | Proposed local | Unrun |
| Window/document/project context | To investigate | To investigate | To verify per application | To verify | Proposed local, separately enabled | Unrun |
| Idle/lock/sleep/session transitions | To investigate | To investigate | To verify | To verify | Proposed local | Unrun |
| Agent run/turn/tool lifecycle and reported result | Existing adapter plus supported harness interfaces | To investigate | To verify | Explicitly distinguish | Preserve current sharing defaults | Unrun |
| Correlation to project and recording session | Explicit IDs/metadata where available | To investigate | No guessed associations presented as fact | To verify | Selected fields only | Unrun |

Use short, deliberate probes and synthetic/selected content where existing permissions allow. Inspect relevant hooks non-destructively; do not replace user configuration. Do not silently enable transcripts, screen capture, keystroke capture or broad filesystem indexing. Where a new OS permission or user-assisted action is necessary, prepare the exact probe and explain the specific signal/access needed. Complete independent source checks while that evidence is pending.

Acceptance:

- One ordinary agent session and one native observation path have evidence, or precise untested/blocked boundaries that do not masquerade as availability.
- Select the smallest useful signal set; explain why each is sufficient or what missing field prevents meaningful reconstruction.
- Specify which session/timer owns recording and the event/correlation model needed for Tasks 2–3. Avoid a schema for every hypothetical provider.
- Record denied/revoked permission behavior, sandbox/distribution implications and offline coverage as demonstrated or still open.
- Produce a concrete Task 2 handoff with chosen ownership, minimal storage approach, tests and unresolved material choices.

Task 1 ends after that bounded discovery pass. It does not automatically expand into a production recorder, new integration, or broad permissions change.

## Task 2 — Record a durable Mac session

Task 1's session ownership, interruption policy and minimal signal scope are confirmed. Begin with the [synthetic durability handoff](2026-09-12-wellspent-capture-signal-matrix.md#6-concrete-task-2-implementation-handoff); live collectors remain gated on the documented acceptance checks. Default: Terra/high.

Implement start/pause/resume/stop and permission status in the native app. Add the smallest appropriate durable local store; use SQLite if supported by the selected ownership decision without introducing unnecessary packages. Commit session transitions and observations consistently. Treat capture-session identity separately from backend delivery identity.

Acceptance: local committed observations survive process restart; pause/stop excludes subsequent observations; explicit transitions/gaps account for sleep, lock and permission loss; collectors unsubscribe/cancel cleanly; no accidental recording resumes after crash; offline operation does not depend on a backend acknowledgement. Preserve current timer behavior and explain the relationship between recording time and focused time.

Use focused native state/lifecycle/persistence tests and an actual Mac scenario. Apply the appropriate repository native-acceptance procedure before claiming live behavior.

## Task 3 — Correlate real agent activity

Depends on Task 2's session/correlation contract. Default: Terra/high.

Extend one verified harness adapter and the MCP entry point only as needed. Add explicit session association and the minimum useful context. Preserve existing IDs, spool, acknowledgement/rejection behavior and account isolation. Contract/client/backend changes are required only for intentionally submitted structured fields; raw local observation storage need not be uploaded.

Acceptance: retries and duplicate hook delivery produce one event; delayed arrival preserves occurrence time and the correct recording interval; outside-session activity is excluded under the chosen policy; missing correlation remains visible; agent-reported success is not converted into verified completion. Test crash/offline delivery and one actual harness path. Do not claim passive desktop attachment from schemas alone.

## Task 4 — Make the timeline inspectable

Depends on Tasks 2–3. Default: Terra/medium.

Render a single session timeline with application intervals, agent events, user notes, source labels and coverage gaps. Support a small correction/annotation flow without erasing original observations. Keep an observed event distinguishable from its interpretation.

Acceptance: the user can reconstruct a recorded session without AI; overlapping agent/application activity is not double-counted as human time; out-of-order events render predictably; empty/denied/incomplete sessions are legible. Verify keyboard interaction and the actual native UI. Do not use a build as proof of accessibility or visual acceptance.

## Task 5 — Reason from evidence and try it during real work

Depends on an inspectable timeline. Default: Astra/high.

Add a bounded recap path using selected session evidence. Reuse the current model/backend path where it fits; a new agent runtime is not required. Keep raw observations local unless the user explicitly includes them in the model input. Save selected input references and the returned recap separately from the original events.

Answer: “What did I work on?”, “What did the agent do or leave unresolved?”, and “Where should I resume?” Reference event IDs and label unsupported conclusions/uncertainty.

Acceptance: synthetic complete, sparse, contradictory and failed-run cases produce grounded responses; real sessions can be manually checked against the timeline; corrections and missing signals are recorded. Measure usefulness through whether the user can resume work accurately, not a generic summary-quality score. Record usage/latency without assuming a model choice is optimal. Improve the recurring evidence gaps before expanding integrations.

## Verification and progress discipline

Use [verification workflows](../verification.md) and current package scripts. Existing relevant checks include `bun run test:capture`, `bun run --cwd packages/api-client typecheck`, `bun run --cwd apps/api typecheck`, and `bun run --cwd apps/macos test`. Select checks based on actual changed behavior; no application suite is necessary for this plan-only change. Database tests use Timer's fixed local stack and must never inherit a hosted database URL or reset existing data.

For each task record status, actual model/effort if known, files changed, commands/results, runtime/OS/build/backend, and unresolved gates. Mark checks pass/fail/unrun. Keep private captured content and credentials out of repository evidence; sanitized fixtures and opaque IDs are sufficient. Preserve existing dirty work and inspect the final diff.

| Task | Status | Evidence / next action |
| --- | --- | --- |
| Plan and handoff | Complete | App/window preparation committed as `6e1b3f5`; discovery executed and recorded below. |
| 1. Signal matrix | Complete; reverified at `0b33e7b` | [Matrix, sanitized probes and Task 2 handoff](2026-09-12-wellspent-capture-signal-matrix.md). Recorded choices preserved; current native/agent evidence and remaining gates distinguished. |
| 2. Recording/durability | Synthetic-storage and live foreground-application implementation complete; selected real-use acceptance pending | [Synthetic durability proof](2026-09-12-macos-synthetic-recording-proof.md) plus the September 12 implementation evidence below. Retention/deletion/disclosure and lifecycle policy are implemented; run the documented signed-build real-use scenario before claiming OS behavior. |
| 3. Agent correlation | Pending | Needs session/correlation contract. |
| 4. Timeline | Pending | Needs durable observations and agent events. |
| 5. Recap/real-use evaluation | Pending | Needs an inspectable timeline. |

## Task 2 live application-activity implementation evidence — September 12, 2026

This continuation implements the gated live Mac slice without changing the authenticated Focus/session path, shared stopwatch, backend contracts, or existing agent adapter. A start event now records an immutable foreground-only capture configuration. While that committed interval is active, `ForegroundApplicationMonitor` reads only the AppKit `NSWorkspace` frontmost application and activation notifications, then saves the localized application name, bundle identifier when present, and process ID through the existing event repository. It does not request Accessibility, Screen Recording, input monitoring, file, window-title, document, screen-content, or network access.

- **Retention, deletion, and disclosure:** foreground records are local-only and retained until the user explicitly deletes a stopped recording. Deletion removes that recording and its immutable local events in one SQLite transaction; it cannot target a different local scope. The controls disclose the exact fields and exclusions before start, the review identifies local/no-upload foreground records, and destructive deletion requires a confirmation dialog. The store remains unencrypted by the already-recorded product decision; there is no automatic retention eviction or upload.
- **Lifecycle and restart policy:** observers install only after a committed foreground-only start or explicit Resume, and unsubscribe after pause, finish, storage failure, shutdown, sleep, or session loss. `NSWorkspace.willSleepNotification` and `sessionDidResignActiveNotification` commit a `suspend` coverage boundary. Wake/session return does not resume collection automatically; the user must explicitly Resume, which creates a new interval and takes a new foreground snapshot. Existing restart recovery still marks unfinished work interrupted and requires explicit Resume.
- **Transition policy:** the initial foreground identity and each distinct activation transition are committed once per authorized interval. A duplicate identity is ignored. Events racing a pause/finish remain subject to the existing serial model/repository boundary checks; after a boundary, the monitor cannot submit a receiver-time observation.

Environment: macOS 26.3 (25D125), arm64, Apple Swift 6.3.3, target minimum macOS 14 with complete concurrency checking. No dependency, entitlement, backend write, or permission change was added. The package build/test command uses `CODE_SIGNING_ALLOWED=NO`, so it is not signed-distribution evidence.

| Executed check | Result and proof boundary |
| --- | --- |
| `bun run --cwd apps/macos test` | Pass. Full native target and tests, including foreground initial/transition de-duplication, pause/sample suppression, `willSleep` and `sessionDidResignActive` notification routing, explicit Resume after suspension, scoped deletion, existing timer behavior, and restart recovery. Result: `apps/macos/.derivedData/Logs/Test/Test-TimerMac-2026.09.12_18-36-23--0400.xcresult`. This uses injected notification/application fixtures for deterministic checks; it does not prove a user-selected desktop transition. |
| `bun run --cwd apps/macos test:recording:crash` | Pass. The existing disposable subprocess harness passed forced termination before write, during transaction, after commit/before acknowledgement, and during migration. It preserves the explicit-resume recovery boundary, but is not a hardware-power-loss test. |
| `bun run --cwd apps/macos lint` and `git diff --check` | Pass. Strict Swift formatting and patch whitespace passed. |

Remaining gates are deliberate: perform the native-acceptance scenario on a signed intended build with a selected non-sensitive application sequence, explicit pause/finish suppression, actual sleep and session-unavailable transitions, and review/delete of the resulting local record. Recheck permission denial/revocation and sandbox/distribution behavior there; this collector itself requests no TCC permission. The local debug artifact was launched during setup but no foreground recording was started, because the available UI automation could not access the app's menu-bar extra. Therefore no real application identity, app-switch, sleep/lock, deletion-dialog, or signed-build claim is made here. Task 3's trusted ordinary-Codex intake remains separate and unimplemented.

## Task 1 original execution evidence — September 12, 2026

- Added [signal matrix](2026-09-12-wellspent-capture-signal-matrix.md), [bounded native probe](probes/macos-signal-probe.swift), [synthetic Codex normalizer probe](probes/codex-metadata-probe.mjs), and [sanitized results](probes/2026-09-12-signal-evidence.json).
- Native probe: compiled with Swift 6/complete concurrency checking; foreground identity and changing idle samples succeeded under a separate ad-hoc App Sandbox signature. Accessibility/Screen Recording preflights were false. App-switch, lock, sleep and wake scenarios remain unrun; the user's running Timer app was not restarted.
- `bun run test:capture` completed both package tasks successfully; the Codex suite reported 22 passing tests. A direct `bun run --cwd integrations/work-log test` also reported 7 passing tests. These used synthetic inputs/fake transports and do not prove installed hooks or backend delivery.
- Codex CLI 0.154.0 schemas were generated; source/configuration inspection found no Timer user/project hook or MCP entry in the locations checked. No private transcripts or credentials were read, and no hooks or permissions were installed/changed.
- The current adapter preserves metadata/export identity and spool behavior, but its timestamp is hook receipt time and it does not retain separate turn/tool IDs. The matrix records the resulting correlation limits and the required sandbox-compatible intake boundary.
- The user confirmed independent local recording with an optional Focus link; suspension with explicit resume after restart; and app identity/transitions, lifecycle gaps and agent completion metadata with richer content disabled. No implementation of Tasks 2–5 occurred.

## Task 1 verification pass — September 12, 2026

The requested Task 1 pass found the matrix, product decisions and original probes already in the dirty worktree. It preserved them and refreshed source/documentation evidence at `0b33e7b`. Actual model/effort was not independently exposed as runtime evidence. Environment: macOS 26.3 (25D125), arm64, Swift 6.3.3, Bun 1.4.0 and Codex CLI 0.154.0; no backend used for testing.

- **Changed files:** this plan, the [matrix](2026-09-12-wellspent-capture-signal-matrix.md), and a separate [sanitized verification record](probes/2026-09-12-signal-verification.json). Original probes/evidence and application/integration/client code were preserved.
- **Passed:** direct capture suite, `bun test integrations/codex/timer-capture.test.mjs integrations/work-log/work-log.test.mjs` — 29 tests, 173 assertions. Pure normalizer probe — metadata defaults, stable IDs and receipt-time limitations reproduced. Fake fetch and temporary spools only; no installed delivery queue was opened or flushed.
- **Passed with narrow runtime scope:** Swift 6/complete-concurrency probe compilation and a five-second normal-host run obtained foreground identity and changing idle values. AX/Screen Recording preflights were false and all transition counts zero. The tool-sandbox run had insufficient workspace access. The current run did not repeat the earlier signed App Sandbox experiment; the existing Timer Debug artifact was inspected and lacks embedded sandbox entitlements.
- **Inspected/generated:** all four requested source owners, session/timer ownership, signing/build settings, standard App Server schemas, and narrow user/project hook/MCP configuration. The user config has `[hooks.state]`, not lifecycle handler arrays; no Timer capture reference or Timer/work-log MCP entry was found. Plugin/managed sources and ordinary live hook delivery remain unverified.
- **Documentation corrections:** Apple documents assistive AX access as incompatible with App Sandbox; TCC permission alone is insufficient. App Store sandbox and outside-store Hardened Runtime requirements are distinct. Current App Server schemas include item occurrence timestamps; the current hook adapter still supplies receipt time. Retention now explicitly distinguishes transient raw hook input, pending/rejected payloads, content-free receipts and model/backend disclosure.
- **Unresolved gates:** ordinary-session metadata capture requires a reviewed local-only hook receiver and selected live session; this task did not install one. App-switch, lock/sleep, denial/revocation, minimum-OS/signed distribution and cross-process intake remain untested. Real-data retention/deletion/disclosure must be settled before persistent capture. Encryption implementation is deferred, not an added gate.
- **Final checks:** evidence JSON, local document links, code fences and whitespace passed. Integration/client sources, original probes and lockfile match saved baseline hashes. Native source/build outputs subsequently changed concurrently and are excluded from the final hash-equality claim.
- **Concurrent work:** final status found new recording files under `apps/macos/TimerMac/Features/Recording/`, `Services/Recording/`, and test directories under `apps/macos/TimerMacTests/Features/` and `Services/`; later hashing also found changed native composition/delegate/window/menu files and build outputs. These changes were not authored, modified or validated by this pass. Task 2's owner must reconcile them with the handoff; no acceptance claim is made here.
- **Task boundary:** Task 1 is complete under acceptance that permits precise untested/blocked signal boundaries. This pass did not implement Tasks 2–5. Next is the matrix's synthetic recording/durability proof, accounting for concurrent work; live capture stays behind its explicit gates.

## Original new-session handoff (historical)

This prompt initiated the completed discovery pass. The next action is the matrix's Task 2 synthetic-durability handoff; all three product choices are confirmed; do not rerun discovery merely because the original prompt below says to start Task 1.

Suggested title: **Wellspent capture — signal discovery**. Select **GPT-6 Astra / High** for Task 1.

Paste/send this prompt in a new Codex session for this workspace:

```text
Read AGENTS.md and docs/design/2026-09-12-wellspent-workflow-capture-plan.md completely. This plan is the current source of scope; crypto-first and integration-first work is deferred. Begin Task 1 only: verify the available Mac and agent-workflow signals, permissions, coverage, and session ownership. Inspect current source and official Apple/harness docs; use the applicable skills. Produce docs/design/2026-09-12-wellspent-capture-signal-matrix.md with documented versus observed evidence and a concrete Task 2 handoff. Complete safe, bounded local probes where access is already available; surface any specific missing permission or user-assisted test without blocking independent research. Preserve the dirty worktree and existing capture privacy/queues. Do not activate broad/persistent capture, change security permissions, install hooks, add dependencies, write production data, or implement Tasks 2–5 as part of this discovery task. Update the plan with evidence and remaining gates. Recommended model: GPT-6 Astra, high reasoning; record the actual model only if known. No further general planning discussion is needed before beginning this task.
```

The current desktop computer-use tool explicitly refused control of the ChatGPT/Codex app, so this planning session could not submit the new chat. Official [new-chat links](https://learn.chatgpt.com/docs/reference/commands#deep-links) can prefill the prompt and workspace but do not send it automatically. The handoff is ready; do not interpret this as a started execution session.
