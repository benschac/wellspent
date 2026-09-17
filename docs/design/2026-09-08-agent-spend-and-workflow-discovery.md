# Agent spend and workflow discovery

**Status:** Discovery planned; interface documentation reviewed; no telemetry integration or recommendation engine implemented.

**Last updated:** 2026-09-08

**Parent:** [Focus Timer architecture and implementation sequence](2026-08-29-focus-timer-product-and-sync-architecture.md#26-recommended-next-implementation-sequence)

## 1. Question and product hypothesis

Can we repeatedly produce advice a user acts on that reduces spend or effort while preserving acceptable results?

Help users choose a model, reasoning setting, and working approach for the next task or phase. Advice may also recommend clarifying acceptance, gathering missing evidence, reducing scope, or splitting independent work. Model price alone does not establish task cost; retries, review, integration, and human corrections matter.

Keep this as a separate discovery slice. It does not replace work-log activation or the durable-session milestones. The initial deliverable is evidence for a product decision, not an automatic model router or a universal efficiency score.

## 2. Current repository boundary

- `integrations/codex/timer-capture.mjs` currently consumes `PostToolUse` and `Stop` metadata. It deliberately does not retain tool arguments, output, prompts, paths, or transcripts.
- `integrations/work-log` provides account-scoped CLI/MCP logging, a private spool, retries, and readback. See [work-log setup and acceptance](../work-log.md); live activation remains a separate gate.
- `packages/api-contract/src/work-log.ts` currently accepts source, thread, event kind, summary, project, and optional focus-session association. It has no model, effort, token, cost, or outcome fields.
- `packages/api-client/src/work-log.ts` is the shared HTTP client. New transport methods can live here after the ingestion contract is designed. Provider SDKs and local harness detection do not belong in this package.
- `apps/web/app/work-log/work-log-workspace.tsx` currently renders recent entries and connection setup. Grouping into tasks/runs and recommendation UI are proposed additions.

Preserve existing capture privacy, delivery IDs, account isolation, and offline retry. Agent activity is not proof of focused human time or completion.

## 3. Interface inventory

Official pages below were opened on 2026-09-08. “Documented” means the vendor describes an interface; it does not mean it has been exercised against this user's running desktop session. Pin versions and retain sanitized fixtures before depending on fields. Examples in documentation may be newer than deployed clients.

### OpenAI and Codex

| Interface | Documented exposure | How we would use it and its boundary |
| --- | --- | --- |
| [Codex CLI non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) | `codex exec --json` emits thread, turn, item, failure, and completion events. The documented completion example includes input, cached input, output, and reasoning output token counts. | Controlled comparison runs. Record launch configuration separately; do not assume every event identifies the actual serving model. Verify cumulative versus incremental usage on resume. This is a run we launch, not passive observation of an existing UI conversation. |
| [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) | TypeScript can start, continue, and resume local threads. Python controls local App Server over JSON-RPC; published builds include a pinned runtime. | Programmatic run management. Choose a language/runtime only after comparing its actual event types. Codex SDK and the general OpenAI API SDK are different products. |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server) | `model/list` includes defaults and supported reasoning efforts. Thread/turn APIs configure execution; notifications include `thread/tokenUsage/updated`, `model/rerouted`, lifecycle events, plans, and diffs. | Strong candidate for precise Codex execution metadata. Verify supported connection/attachment and subscription behavior before promising monitoring of an already running app. Do not resume, fork, or control a live thread merely to collect telemetry. |
| [Codex hooks](https://learn.chatgpt.com/docs/hooks) | Lifecycle callbacks provide integration points around agent work. | Lowest-friction extension of current capture. Inspect each event's actual payload for model/effort/usage; hook availability alone does not establish complete accounting. Any transcript access is a separate opt-in, not an implicit extension of current capture. |
| [OpenAI Responses API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) | Response objects include model and usage, including input/cache and output/reasoning token details. The request carries the selected model and reasoning configuration. | Instrument requests made by an application we own. Store requested configuration separately from returned identity. These responses do not provide visibility into unrelated Codex subscription sessions or prove invoice cost. |
| [OpenAI API SDKs and CLI](https://developers.openai.com/api/docs/libraries) | Official libraries and API command-line tooling provide programmatic API access. | Wrap our own request boundary and retain response usage/IDs. Installing an SDK does not give access to other applications' traffic. No provider SDK dependency is needed for this documentation slice. |
| [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents) | An application framework for agent workflows, tools, handoffs, and tracing. | Relevant if we later own orchestration. It is not an observer for arbitrary Codex/Claude sessions. Exact usage aggregation, trace export, and sensitive-data defaults require their own implementation audit before adoption. |

**Local static verification:** `codex --version` returned `codex-cli 0.153.4`. `codex app-server --help` exposes schema generation, daemon/proxy commands, and stdio/socket transports. Generated schemas with:

```sh
codex app-server generate-json-schema --out /tmp/timer-model-discovery-schema-20260908
```

Inspected `v2/ThreadTokenUsageUpdatedNotification.json`: usage has `last` and `total` objects with `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningOutputTokens`, and `totalTokens`. `ThreadStartResponse.json` includes model-provider and reasoning-effort fields; `ModelReroutedNotification.json` exists. These confirm local protocol shapes, not event delivery, billing accuracy, or desktop attachment. Generation succeeded with a non-fatal PATH-alias permission warning. Temporary generated schemas are not repository artifacts; regenerate for the runtime under test.

### Claude and Cursor

| Interface | Documented exposure | How we would use it and its boundary |
| --- | --- | --- |
| [Claude Code OpenTelemetry](https://code.claude.com/docs/en/monitoring-usage) | `claude_code.api_request` includes model, effort when supported, token/cache counts, estimated cost, duration, request correlation, and query source. Metrics also report token and cost usage. | Preferred second-harness discovery candidate: opt-in telemetry from normal interactive work. Prototype a local OTLP receiver/collector and an allowlist adapter. Never sum request events and aggregate metrics as independent usage. Keep prompt/tool-detail logging disabled. |
| [Claude Code hooks](https://code.claude.com/docs/en/hooks) | Lifecycle callbacks for tools, sessions, and agent activity. | Correlate task boundaries and explicit outcome notes. Verify payloads and identity joins against telemetry; hooks are not a substitute for request accounting. |
| [Claude CLI programmatic mode](https://code.claude.com/docs/en/headless) | `claude -p` supports programmatic execution and structured output options. | Controlled comparison runs. Record configuration and authentication/billing mode. This executes work rather than observing an existing interactive session. |
| [Claude Agent SDK cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking) | Result messages provide `total_cost_usd` and per-model `modelUsage` (Python: `model_usage`). Top-level `usage` excludes subagents, whereas those other totals include them. Shared message IDs can repeat usage; streaming input and crash cases require special handling. | Useful for experiments we launch. Treat costs as estimates. Test call/turn boundaries, nested agents, duplicates, and interrupted runs before aggregating; a crash can yield zeroed fields rather than zero consumption. |
| [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create) | Response model, input/output/cache usage, and documented thinking-token detail. | Instrument calls we own through the API or its SDK. Preserve provider-native thinking/effort settings and field availability; do not equate them numerically to OpenAI effort levels. No implied access to Claude Code subscription history. |
| [Cursor Cloud Agent metadata](https://cursor.com/docs/cloud-agent/metadata) | Managed agent VMs expose run metadata including the serving model. The API is preview and local to the VM; self-hosted workers do not currently serve it. | Potential later adapter. Model identity alone does not establish tokens, cost, or a complete cross-turn history. Verify each needed field and export mechanism. |
| [Cursor Router](https://prod.cursor.com/docs/cursor-router) | Auto routing selects models by task complexity and cost/quality tradeoffs; the documented router currently requires Teams or Enterprise. | Competitive baseline: recommendations must add value beyond routing already available in the harness, particularly task preparation and outcomes across tools. |

`claude --version` returned `2.1.226`. Telemetry, credentials, SDK execution, and billing were not exercised. Gemini, GLM, and other harness/provider combinations remain unaudited; do not promise adapters or infer telemetry from model-family names.

## 4. Proposed observation model

Design fixtures before changing the production contract. Keep a task (user intention), a run (execution attempt), and usage observations distinct. One task can span multiple runs, harnesses, models, and optional focus sessions.

- Identity: account, project, task/run/thread/turn/request IDs where available, parent run, harness/provider/model, runtime and adapter versions.
- Configuration: requested model and provider-native effort; observed model and reroutes as separate facts. Missing values remain unknown. Reasoning-token counts do not prove that an effort setting was appropriate.
- Usage: input/output/cache/reasoning fields with source, scope, and whether values are increments or cumulative snapshots. Preserve provider-specific inclusion semantics so cache/reasoning subsets and parent/child totals are not counted twice.
- Resource accounting: estimated API-equivalent cost, provider-reported estimate, billed amount, and subscription allowance are different fields. Store currency, pricing version/date, and provenance. Missing billing data is not zero cost.
- Outcome: task phase, predefined acceptance checks, observed check results, user acceptance, corrections, review time, and later rework. Agent claims remain labeled separately.
- Recommendation: proposed next action, rationale, evidence references, confidence, accepted/dismissed status, and later outcome. Preserve the original advice so it can be evaluated honestly.

Raw prompts, tool arguments/results, code, paths, and transcripts stay out of default uploads. Use explicit task labels and user-approved summaries. Prototype collectors locally; define retention/deletion and export allowlists before activating real capture. An MCP recommendation tool can consume normalized observations, but MCP alone is not a universal model/usage feed.

## 5. Bounded discovery sequence

1. **Verify the interfaces.** Capture sanitized fixtures from one Codex route and Claude Code telemetry. Prefer observing the existing workflow where supported. Record fields, unavailable fields, version, transport, attachment limits, and authentication requirements. Use controlled SDK/CLI runs only where needed to answer a specific gap.
2. **Prove accounting.** Replay fixtures for duplicate delivery, cumulative updates, resume, model switches, nested/background agents, missing usage, failure, and restart. Establish one authoritative accounting source per run. Demonstrate totals without double counting before showing dollar figures.
3. **Review 20–30 real tasks.** Include discovery, bounded implementation, debugging, and cleanup. Record acceptance before work, then checks, user assessment, spend/usage coverage, elapsed time, and human effort. This is exploratory evidence from one user, not a general benchmark.
4. **Write advice manually.** Produce one actionable suggestion at a meaningful phase boundary. Record whether the user followed it and what happened. Include preparation and delegation advice, not only model downgrades. Do not infer hypothetical savings from a single successful expensive run.
5. **Compare repeatable tasks.** Select a few safe tasks with identical initial repository state, instructions, tools, and acceptance checks. Use the user's usual workflow as the baseline. Vary one factor at a time (model, effort, or preparation), repeat where practical, and record cache state/order effects. Evaluate parallel agents separately, including integration and review cost. Agree on an execution spend cap before paid trials; this plan authorizes no paid benchmark runs.
6. **Make a product decision.** Report suggestions acted on, observed cost/effort changes, acceptance and rework outcomes, instrumentation burden, and missing data. Include gains and losses across all evaluated interventions, counting advice-following effort, retries, review, and rework. Continue only if advice repeatedly helps and produces positive aggregate savings against the usual-workflow baseline without degrading the agreed result. If a harness's built-in routing suffices or observation is too intrusive, narrow or stop the feature.

Required discovery artifacts: versioned capability matrix, sanitized event fixtures, accounting test results, task review ledger, suggestion/outcome log, small comparison report, and a go/narrow/stop decision. Implementation and live collection remain future work.

## 6. UI experiment and ownership

Prototype a task/run detail in `/work-log`: intention and outcome first, then model/effort and resource usage, with one expandable suggestion. Show unknown/partial coverage explicitly. Offer “Accepted,” “Needed rework,” and “Still investigating” outcome feedback; advice has separate accept/dismiss controls. Keep suggestions out of the ticking timer and avoid a numerical efficiency score until calibration supports one.

Example copy, not a measured finding:

> Try a smaller model for the next step. The specification is fixed and a verification command exists. Basis: task structure; limited personal outcome data.

Adapters belong under `integrations`; normalized validation and API definitions belong in `packages/api-contract`; HTTP access belongs in `packages/api-client`; ingestion/read models belong in the API; presentation belongs in `/work-log`. Reuse durable spool behavior only after checking compatibility with usage-update semantics. Decide tables and migrations after fixtures establish event granularity. No new dependencies, provider proxy, orchestration platform, schema migration, or automatic model switching is selected by this plan.

## 7. Acceptance and evidence status

Discovery succeeds when multiple documented suggestions are acted on and show positive aggregate savings across all evaluated interventions against the user's usual workflow, with acceptable results and known accounting coverage. Count advice-following effort, retries, review, and rework, including interventions that increase cost or effort. Report spend and human effort separately. Set task-specific quality criteria before comparisons; report mixed or inconclusive results rather than converting them into a score.

- Completed: official interface review; repository ownership inspection; local CLI versions; Codex protocol schema generation and field inspection.
- Unrun: live Codex attachment/event capture; Claude OTLP receiver; account billing reconciliation; adapter implementation; real-task study; paid comparisons; UI interaction.
- This change is documentation only. It neither enables observation nor changes existing work-log/focus behavior.
