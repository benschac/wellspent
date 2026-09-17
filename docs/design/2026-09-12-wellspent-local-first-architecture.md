# Wellspent: local-first architecture, first research pass

Date: September 12, 2026. Status: immediate product priority and device-role decision recorded below; encrypted-sync design remains future research. No implementation authorization or production acceptance is implied.

**September 17 update:** E2EE sync is now a firm requirement and portable Rust/protocol feasibility is selected for early architectural attention. The [visual system design](2026-09-17-wellspent-system-design.md) consolidates current/target ownership, the confirmed disclosure routes and experiment order. Earlier statements below that defer all encrypted-sync research describe the September 12 priority; they no longer set the active queue. No vault implementation or production acceptance is established by this update.

For what to do next, start with [the current plan](../WELLSPENT_PLAN.md). This document owns product/device roles and future architecture. The companion [security design](2026-09-12-wellspent-security-design.md) defines the proposed trust boundaries. The [decision register and roadmap](2026-09-12-wellspent-research-roadmap.md) identifies deferred questions, evidence, experiments, and gates.

## Immediate priority: capture the user's actual workflow

Priority/status/handoff source of truth: [current plan](../WELLSPENT_PLAN.md). Detailed execution scope and acceptance: [workflow-capture plan](2026-09-12-wellspent-workflow-capture-plan.md).

The user clarified that the immediate value is access to difficult-to-obtain personal workflow evidence: agent activity through CLI/MCP, and granular, user-controlled machine activity through the native Mac app. Calendar, Linear, other integrations, and custom encrypted sync are lower priority. The next useful outcome is a timer-bound record the user can inspect and reason about after real work.

Use the existing backend for the current structured work-log/session path. Keep newly collected detailed machine observations local initially, with explicit selection before any backend/model disclosure. This is an interim product direction; the independent-device/local-first goal below remains the future target. Do not make Rust crypto, provider integrations, or a new hosted agent runtime prerequisites for proving capture usefulness.

Owning boundaries verified in the current source:

- `packages/api-client/src/work-log.ts` exposes `createWorkLogClient` for shared authenticated transport. It does not collect machine activity or implement an MCP server.
- `integrations/work-log/mcp.mjs` owns MCP log/list/flush/status tools; `integrations/codex/timer-capture.mjs` owns the current agent capture adapter. Preserve their delivery IDs, account isolation, retry behavior, and explicit content-sharing boundary.
- `apps/macos` owns native permissions, capture controls, local observation storage, and the session timeline. Foreground application identity/transitions and lifecycle suspension are now implemented through `ForegroundApplicationMonitor`; signed/live acceptance remains open. Richer window/document/screen collection is outside the accepted minimal scope.

First outcome: start a recording session, do ordinary work with one agent harness and several Mac apps, pause/stop, and inspect a durable timeline connecting observed machine activity, available agent events, and user notes. Then answer “What did I work on, what did the agent do, and where did I leave off?” with links to the supporting events and visible gaps.

The [signal matrix](2026-09-12-wellspent-capture-signal-matrix.md) records the completed first discovery pass and minimal scope. Any future expansion must map its source, permission, available detail, retention/disclosure and denied/revoked behavior. Exact OS and harness access must be demonstrated; granting a permission does not guarantee semantic content. Rich agent text, paths, screenshots and UI content require a separate collection decision.

The accepted model is an independent local recording with an optional immutable Focus association. The shared singleton stopwatch does not authorize collection. Preserve event time separately from upload time, pause/stop boundaries, explicit resume after interruption, restart recovery, and coverage gaps. App foreground duration, agent execution, user-reported work, and inferred focus/completion are separate evidence categories. Background agent activity must not be counted as focused human time merely because it overlaps a recording session.

See the [immediate handoff](2026-09-12-wellspent-research-roadmap.md#next-handoff) and the earlier [agent-workflow discovery](2026-09-08-agent-spend-and-workflow-discovery.md) source inventory. Older runtime observations there require revalidation before implementation.

## September 17 memory integration candidate

The user's clarified goal is to understand actual Codex terminal work, project/task and application switches, model/effort/usage, and subsequent GitHub review/rework. They are open to a memory service such as Plastic Labs/Honcho interoperating with Codex, Hermes and other agents. E2EE sync is now a firm product requirement. Selected hosted-AI disclosure goes directly from device to provider by default; an optional premium feature may route selected plaintext through Wellspent's backend. The [current plan](../WELLSPENT_PLAN.md#september-17-architecture-sprint--requirements-being-resolved) owns these decisions and remaining questions.

Proposed ownership, not an implemented integration:

- Wellspent owns original evidence, stable identities, task/run/PR associations, corrections, usage accounting and disclosure grants. Device repositories and encrypted replication remain authoritative for personal records.
- A memory adapter receives an authorized subset and produces derived memories with source references, derivation/version metadata and visible uncertainty. A generated conclusion cannot become an original observation, a verified outcome or a permission grant.
- **First experiment: show findings to the user, with evidence, uncertainty and correction controls. Agent feedback is deferred by user decision.** Do not inject derived lessons into Codex/Hermes or enable agent retrieval as part of this experiment. In a later separately scoped phase, agent adapters may consume permitted context; record which memory version was supplied to a run so outcome comparisons distinguish runs that received a suggestion from those that did not. Attribution is not causal proof.
- A memory service is replaceable. Original records must remain usable when it is unavailable, disconnected or replaced. Test rebuilding selected derived memory from authorized evidence, propagation of corrections/deletion, and whether provider-retained artifacts require separate deletion. Disconnecting cannot retract previously disclosed information.
- The premium plaintext-processing path is a separate disclosure boundary from the opaque sync relay. Subscription entitlement alone does not authorize disclosure. No vault keys go to that processor. Specify approved payloads, retention, recipients and receipts before implementation; pricing does not settle these controls.

Documentation checked September 17, not runtime acceptance: [Honcho](https://github.com/plastic-labs/honcho) offers managed and self-hosted memory over messages/events. Its documented local stack includes a reasoning worker and model-provider configuration; self-hosted storage alone does not establish offline inference. [codex-honcho](https://github.com/plastic-labs/codex-honcho/blob/main/README.md) documents lifecycle-based conversation capture, a local queue and background upload, plus directory/branch/chat session strategies. [Hermes memory providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers) documents Honcho support and automatic conversation synchronization/context injection. These defaults require review against Wellspent's selection and recording boundaries; no plugin was installed or activated. No reviewed source establishes that a hosted memory processor can reason over Wellspent's opaque encrypted records without a separate plaintext disclosure.

Candidate experiment: use one synthetic task spanning two Codex sessions and a PR review, with a corrected review finding, an unrelated private canary and a later similar task. Compare simple retrieval from selected evidence with a memory-provider adapter, presenting findings only to the user. Require traceable source references, correct handling of the correction, no out-of-scope context, a visible delivery/disclosure receipt, and preserved local review when the provider is unavailable. Test deletion/export/rebuild separately and measure total usage/latency. First prove the adapter contract with a fake provider; select actual local/hosted execution and credentials before a provider-backed run. Agent feedback and any measurement of its effect belong to a later phase. This is a proposed proof, not a selected dependency or implementation authorization.

## Assessment of the future encrypted architecture

The product direction is coherent: devices own personal records, a relay transports encrypted replicas, and narrowly delegated cloud services execute integrations. Agent runtimes operate through Wellspent's permissions and disclosure controls. Vault keys, local storage, and important application state remain independent of the model provider.

The largest architectural change is replacing server-authoritative personal state. This is not an encryption wrapper around the current API: the server presently validates plaintext commands and builds projections. An opaque relay cannot keep doing those jobs. The client domain and replication rules must take over, while the server retains account, billing, routing, and delegated integration responsibilities.

Retain the vault/epoch hypothesis, Rust crypto core, native Swift macOS app, and existing Expo mobile app for future encrypted-sync research. Treat HPKE, the exact cipher suite, persistence ownership, and the Agents API runtime as candidates pending the gates below. Do not implement Double Ratchet or adopt libsignal as the foundation. Do not freeze a wire format from the illustrative APIs in the initial brief.

## Accepted decision: Mac-centered, independently writable devices

The user confirmed that a task created on the phone while the Mac is asleep must save locally and sync without waiting for the Mac. The Mac is the primary workspace and preferred device for rich context, indexing, and heavy computation. It is not a required write leader or approval hop for ordinary changes from an already trusted device.

Each trusted device durably commits its own changes. When connectivity, credentials, and membership validation permit, the phone uploads encrypted operations directly to the relay; other online trusted peers can receive them. Without connectivity, changes remain locally saved and queued. The Mac catches up when it returns. Local save, relay acknowledgement, and application on another device are distinct delivery states; “immediate sync” does not promise execution while the mobile OS suspends the app.

This settles device roles, not conflict resolution or which records replicate. Shared records still need convergence rules; some context may remain Mac-only. The first data scope, membership authority, recovery details, and web participation remain separate decisions.

## Current implementation versus target

Evidence is the local working tree inspected on September 12, including existing uncommitted work. No database, deployed service, live integration, or physical device was inspected. Older design documents describe both implemented behavior and targets; the source boundaries below take precedence.

| Area | Current owning code and observed behavior | Target and migration consequence |
| --- | --- | --- |
| Personal sessions | [FocusRepository](../../apps/api/src/focus/focus.repository.ts) stores and reads plaintext intention/recap, locks rows, and validates/deduplicates commands in Postgres. | Local committed records and deterministic replica rules become authoritative. Retain IDs, command identity, and separate timer/recap revisions during import. |
| Browser recovery | [focus-outbox.ts](../../apps/web/app/focus/focus-outbox.ts) stores account-scoped JSON commands/snapshots; [use-focus-sessions.ts](../../apps/web/app/focus/use-focus-sessions.ts) opens localStorage and refreshes/replays through [focus-session-sync.ts](../../apps/web/app/focus/focus-session-sync.ts). | Preserve queued work. IndexedDB is still a target. Whether web becomes a trusted vault peer is an explicit decision, not implicit scope. |
| Shared domain | [session-domain](../../packages/session-domain/README.md) owns TypeScript schemas, timing/transition rules, and projection fixtures. Repository interfaces and native persistence are explicitly future work. | Reuse domain semantics and fixtures. Decide how Swift shares or independently conforms to them; crypto Rust does not automatically share TypeScript business rules. |
| macOS | Local recording history now uses SQLiteData/GRDB behind `RecordingRepository`, with transactional events and restart recovery (see [native persistence](2026-09-13-macos-sqlitedata.md)). [FocusModel](../../apps/macos/TimerMac/Features/Focus/FocusModel.swift) calls the focus HTTP API and holds sessions/pending mutations in memory. [FocusAuthStorage](../../apps/macos/TimerMac/Services/Auth/FocusAuthStorage.swift) persists authentication in Keychain. | Authenticated focus-session persistence, durable outbox, vault identities, and key lifecycle remain new work. Existing auth Keychain storage is not an encrypted personal database. |
| Expo mobile | [package.json](../../apps/mobile/package.json) declares Expo 57, expo-sqlite and expo-secure-store. The [timer screen](../../apps/mobile/app/(tabs)/(index,history,settings)/index.tsx) uses the shared stopwatch package. | Package installation does not establish database use, SQLCipher configuration, or authenticated focus replication. Keep the existing app; prove Android and iOS separately. |
| Shared stopwatch | [RealtimeTimerRepository](../../apps/api/src/realtime/realtime-timer.repository.ts) persists singleton row `id = 1`, distinct from authenticated focus sessions. | Do not import it as personal session history or call it encrypted multi-device sync. Plan its replacement or coexistence explicitly. |
| Work evidence/MCP | [work-log MCP](../../integrations/work-log/mcp.mjs) exposes log/list/flush/status; [WorkLogRepository](../../apps/api/src/work-log/work-log.repository.ts) persists account work entries on the server. [Codex capture](../../integrations/codex/README.md) has a metadata-first export boundary. | Reuse capability naming, retry, and provenance lessons. The existing local MCP process is a cloud work-log adapter, not a private-vault search service. |
| Integrations | [GoogleOAuthService](../../apps/api/src/google/google-oauth.service.ts) uses server-decryptable token encryption. [Calendar publication](../../apps/api/src/google-calendar/google-calendar-publication.service.ts) reads completed server sessions and queues selected event payloads. | Preserve the credential owner and job machinery. Move private-record-to-action conversion to the client; submit only an approved payload. |
| Agent runtime | [AssistantService](../../apps/api/src/assistant/assistant.service.ts) streams chat through the AI SDK gateway. No Agents API session/executor integration was found in the inspected application paths. | Add a runtime adapter after the disclosure and execution policy is defined. Existing chat is not a durable action runtime. |

The [August architecture checkpoint](2026-08-29-focus-timer-product-and-sync-architecture.md#26-recommended-next-implementation-sequence) remains the record of existing work. This proposal changes its long-term Postgres-canonical assumption for private data. It does not silently replace the current implementation queue or declare its outstanding acceptance complete. Transactional recovery work remains useful; further investment in plaintext server arbitration needs this decision first.

## Target ownership

| Component | Owns | Must not become authoritative for |
| --- | --- | --- |
| Local repository on each trusted device | Personal records, durable pending operations, projections, conflict evidence, local checkpoints | Provider execution state or another device's delivery acknowledgement |
| Crypto protocol core | Device/vault trust validation, authenticated envelopes, key epochs, encrypted records, recovery formats | Calendar semantics, timer conflict policy, SQL queries, user consent decisions |
| Replica engine/domain | Causality, replay, deduplication, conflict resolution, tombstones, deterministic projections | Cryptographic primitives or cloud credentials |
| Relay | Opaque objects, envelopes, delivery cursors, quota/account/device routing metadata | Plaintext validity, latest trusted membership, personal projections |
| Local capability broker | Session grants, private context selection, local action enforcement, disclosure receipts | Arbitrary model instructions as authorization |
| Cloud integration service | Delegated OAuth credentials, approved action payloads, webhook/job state, provider reconciliation | Implicit access to the private vault |
| Runtime adapter | Provider session IDs/events, tool dispatch, cancellation, usage and resumable orchestration | The only copy of permissions, tasks, automation definitions, or receipts |

The normal data path is local transaction → durable operation/outbox → authenticated encryption → relay → recipient validation/decryption → local transaction/projection. UI reads committed local state. Notifications only prompt catch-up; a relay cursor is a delivery position, not proof of authenticity or completeness.

The agent path is local context → local selection/aggregation → permitted disclosure → hosted reasoning → proposed action → Wellspent approval/enforcement → integration. These boundaries apply equally to direct tools, programmatic calls, retries, and subagents.

## What the initial proposal needs to change

### Trust and synchronization before wrappers

Define an independently pinned vault identity and authenticated membership history. A login session is not permission to decrypt or enroll a device. QR pairing must bind both device identities, roles, vault, suite, nonce, expiry, and the membership checkpoint; merely displaying one public key does not complete mutual authentication.

Write down concurrent membership and offline-revocation behavior before implementing envelopes. Signed history helps detect invalid updates and conflicting views once compared; it cannot establish freshness when a malicious relay withholds all newer information. The security design records this limit.

Use immutable operations as the first replication hypothesis and keep conflict rules outside crypto. Prototype same-session concurrent pause/finish, independent sessions, concurrent recap edits, and deletion versus offline edits. A Lamport timestamp orders operations but does not decide valid timer semantics. Preserve conflicting work until a deterministic rule or user resolution handles it. A CRDT is justified only if specific editing behavior requires one.

### Local durability earlier in the sequence

Keep the CLI first for protocol testing, but move SQLite ownership and crash consistency ahead of a production relay. Encryption without a durable transaction boundary can lose queued work or mishandle retries/nonces after restart. Test one local repository with the CLI or a storage harness before making the platform wrappers the integration point.

Choose whether Rust owns only crypto, crypto plus replication, or also persistence. The default to investigate is a small crypto component with explicit state inputs/outputs and platform repositories; this is not a decision to duplicate the replica algorithm in Swift and TypeScript. Compare shared replication Rust against conformance-tested platform implementations before freezing APIs.

### Agent execution is an explicit data release

Official documentation verifies laptop/self-hosted execution over outbound connections, but a session has its own executor/environment identity. This supports the concept; it does not prove background lifecycle or consumer provisioning. [Self-hosted environments](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted).

The managed Agents API currently retains state and supports US data residency only, without ZDR eligibility, including with a self-hosted environment. The reviewed data-controls table lists Agents application state until deletion. Session deletion may clean up asynchronously. Product copy must state what is disclosed and retained. [Overview](https://developers.openai.com/api/docs/guides/agents-api/overview), [data controls](https://developers.openai.com/api/docs/guides/your-data), [session deletion](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage#delete-a-session).

Programmatic filtering in the hosted harness reduces model context, but raw results have already left the device if they reach that runtime. Filter private data inside the local broker before returning any result. [Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling#agents-api).

An unrestricted executor on the user's Mac could bypass semantic MCP restrictions through files, commands, or credentials. Investigate an isolated executor with no raw database/key access and a separately protected capability broker. A working directory alone is not that boundary. Prefer application-handled functions and selected context for the first product experiment if executor isolation is not yet proven. [Sandbox security](https://developers.openai.com/api/docs/guides/agents-api/environments/security).

## Deferred experiments, different decisions

These experiments are retained for later; the workflow-capture priority above supersedes their original position as the next step. Before resuming encrypted-sync implementation, resolve the first five rows of the [decision register](2026-09-12-wellspent-research-roadmap.md#blocking-decisions). The two later tracks answer different questions:

1. **Privacy and replication feasibility:** protocol CLI plus local persistence; hostile relay, rotation/recovery, and restart scenarios. This asks whether we can keep the product's privacy and durability promises.
2. **Planning usefulness:** selected project context plus Calendar/Linear fixtures, producing an actionable three-hour plan. First read-only; then one approved calendar hold through a real provider in a separately authorized test. This asks whether the product helps enough to justify the infrastructure.

Both can use synthetic data. Neither requires broad capture, a production relay, universal tool search, autonomous workflow learning, or every integration.

The present Google scope is `calendar.app.created`, declared in [GoogleConfig](../../apps/api/src/google/google.config.ts). The current publication path does not provide today's personal-calendar availability. The planning experiment therefore needs a separate read capability, consent, and fixture/live-data gate. Linear is also a new integration. Do not estimate the MVP as wiring together already-complete capabilities.

## Migration and product boundaries to retain

Inventory which data is private vault content, intentionally delegated content, account metadata, or device-only observation. Start the proposal with focus sessions, recaps, work entries, and manually selected project context. Keep full files/browser history/ambient observation out of the initial dataset.

An eventual import must preserve identities, timestamps, provenance, user edits, and unacknowledged commands. Import into a new local scope, reconcile and verify it, then enable encrypted uploads. Avoid indefinite plaintext dual-writing. Importing into E2EE does not erase plaintext already present in server backups, logs, exports, provider records, or old clients. Any later deletion requires a separate retention plan and authorization.

Local read/edit/export must remain usable when a paid relay subscription ends. Recovery requires surviving encrypted data, not merely a code. Design encrypted portable backups, relay replacement, quotas, and retention together. Protocol publication and a reference relay can support portability; final licenses and commercial packaging remain separate decisions.

The browser deserves an explicit scope decision: a server-delivered web client has a different code-delivery trust boundary from signed native apps. Proposed first encrypted peers are Mac/iOS/Android, with existing web kept on its current lane until migration is decided. This proposal does not remove web functionality.

## Completion boundary for this pass

Completed: current-source map, first security design, verified technology findings, unresolved decision register, and outcome-sized research gates. No application behavior, dependency, database, secret, account, deployment, or external integration was changed. Cryptographic review, physical-device behavior, SDK/account eligibility, and production claims remain unverified.
