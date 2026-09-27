# Wellspent MCP and Effect integration plan

Date: September 26, 2026

Status: All three slices implemented in the working tree; verification evidence is recorded below. Live Codex/native-app compatibility remains a separate acceptance check. The current priority and milestone status remain owned by [WELLSPENT_PLAN.md](../WELLSPENT_PLAN.md).

## Recommendation

Refactor the local MCP path in `integrations/codex` in three bounded slices: protocol lifecycle, Effect domain behavior, then cancellation and execution policy. Start with `log_work`; expand only when another feature needs these abstractions.

Recommended implementation model: **GPT-6 Astra with High reasoning**. This is an engineering recommendation for the interacting protocol, authorization, durable-write, and cancellation invariants, not a benchmark claim. Model configuration must be selected in the execution environment; this document does not change it.

## Ownership and target architecture

```text
AI client
  -> MCP SDK: serveStdio + StdioServerTransport
  -> MCP adapter: input validation and result conversion
  -> Effect domain: HarnessConnection + HarnessClient + logWorkProgram
  -> Native adapter: existing local IPC and durable request/receipt handling
  -> Wellspent macOS
```

- The MCP SDK owns framing, stdio buffering, backpressure, protocol negotiation, EOF, and transport closure.
- Effect owns domain effects, typed failures, dependency injection, interruption, execution policy, and tracing.
- Node owns native filesystem and HTTP primitives.
- Shell tools belong only where an external command is actually required. Do not introduce Bash, zx, Execa, custom readline, JSON-RPC framing, or another stream abstraction into MCP transport.
- Domain code must not import MCP types or return MCP responses.
- Use Effect Schema at the MCP input boundary through Standard Schema validation and JSON Schema conversion, preserving the existing input contract. This migration is implemented in Slice 2. Keep simple deterministic functions as ordinary functions.

## Source baseline before Slice 1

- [harness-mcp.ts](../../integrations/codex/harness-mcp.ts) already uses the official SDK and a 128 KiB stdio buffer limit. It calls `server.connect()` directly and binds native authorization in the legacy `initialize` handler, using `binding`, `ready`, and `oninitialized`.
- [harness-helper.ts](../../integrations/codex/harness-helper.ts) owns connection checks, discovery, signed local HTTP calls, durable request identities, terminal receipts, and native acknowledgement polling.
- `logWork` currently uses a three-second HTTP fetch timeout and a ten-second default acknowledgement wait. These are separate stages, not a single ten-second end-to-end deadline.
- Rejected native results currently return structured JSON with `id`, `status`, `reason`, and `nativeReceivedAt`, followed by the conservative unconfirmed message. Thrown failures return only the conservative message.
- The repository already declares `effect@4.0.0-rc.112`; the integration package does not yet declare Effect directly. The proposed v3 `Effect.Service` and `Context.Tag` examples must be adapted to v4.
- Existing harness tests exercise native acknowledgement, inactive attempts, identity conflicts, connection replacement, bounded stdio, and standalone Node bundles.

These observations came from source inspection, not a fresh execution of those tests. Recheck installed SDK and Effect APIs before implementation.

## Invariants to preserve

1. One stdio connection binds to one successful native connection ID. Successful resolution is immutable, including across SDK discovery probes and legacy fallback.
2. Concurrent initial resolution shares one attempt. Failed resolution may be retried; successful binding is never reset to follow a replacement identity.
3. Every discovery and write checks the bound identity against current authorization. Revocation or replacement fails; an old session cannot rediscover or return old acknowledgements through a new identity.
4. `tools/list` retains the native `discover()` gate. Wellspent authorization is independent of protocol handshake implementation.
5. Caller-supplied UUID and exact text remain stable across uncertain retries. No new UUID is generated to retroactively admit an inactive or rejected call.
6. Native durable acknowledgement is the only successful write outcome. A timeout or cancellation does not prove that a write failed or was rolled back.
7. Terminal rejection bookkeeping remains durable. Cancellation must not make an originally inactive or unavailable attempt eligible for later admission.
8. MCP stdout contains protocol traffic only. Logs go to stderr or an explicitly configured local sink.
9. Do not log note text, prompts, transcripts, tool arguments/output, filesystem contents, connection secrets, or raw private errors.

## Slice 1: MCP lifecycle

### Work

- Replace direct connection startup with `serveStdio(factory, options)`.
- Keep `StdioServerTransport` and `maxBufferSize: 128 * 1024`.
- Create a connection binding owned by the stdio invocation, outside the SDK factory. The SDK may create a discovery probe instance before falling back to legacy initialization.
- Resolve the binding through the factory as required, then pass the immutable expected connection ID into the adapter.
- Remove application authorization from `initialize`; remove `ready`, `oninitialized`, and the old initialization state machine.
- Keep `_wrapHandler` only for the `tools/list` discovery gate where no suitable public SDK seam exists.
- Adapt callers and tests to the lifecycle handle returned by `serveStdio`, including shutdown.
- Keep input validation, tool descriptions, native behavior, and MCP result content unchanged.

### Acceptance

- Legacy initialization and current protocol negotiation both work.
- Discovery probe followed by legacy fallback cannot switch native identity.
- Failed initial resolution can recover without resetting a successful binding.
- Concurrent requests share binding resolution.
- Revocation and reconnection invalidate the old session.
- Buffer limits, malformed input handling, EOF, and close remain SDK-owned.

## Slice 2: Effect domain and typed outcomes

### Work

- Read `node_modules/effect/AGENTS.md` completely before writing Effect code and follow required linked guidance.
- Declare Effect in the integration package using the repository's version convention.
- Replace the Zod input schema with one Effect Schema exposed through `Schema.toStandardSchemaV1` and `Schema.toStandardJSONSchemaV1`. The installed MCP SDK accepts their combined Standard Schema interface. Explicitly reject excess properties; preserve the UUID grammar, exact text, nonblank/UTF-8/well-formed-Unicode checks, descriptions and advertised JSON Schema constraints. Keep validation diagnostics free of submitted values. Remove the direct Zod dependency only after checking other package consumers; the SDK still depends on Zod internally.
- Use Effect v4 `Context.Service` and explicit layers, following installed APIs.
- Introduce `HarnessClient` for native connection resolution, discovery, and logging; represent the bound identity with `HarnessConnection`.
- Treat the root as explicit configuration; introduce a separate `HarnessRoot` service only if it improves composition.
- Implement `logWorkProgram` and discovery as domain programs. Inject the native adapter in production and lightweight service implementations in tests.
- Build the runtime once per stdio connection or inject an already-resolved connection value. Do not rebuild effectful connection resolution on every tool call.
- Dispose any managed runtime at connection shutdown, including EOF and error paths. A discarded SDK probe must not dispose a runtime still owned by the stdio connection.
- Wire dependent layers with explicit provision; merging layers alone does not satisfy their dependencies.
- Centralize conversion from domain success/failure to MCP results.

### Failure model

Represent meaningful failures such as:

- `ConnectionUnavailable`
- `ConnectionRevoked`
- `ConnectionChanged` (or an explicit equivalent classification)
- `RecordingInactive`
- `IdConflict`
- `NativeTimeout`
- `NativeRejected`
- `NativeStorageFailure`

Map actual native reasons, including `identity_conflict`, `connection_changed`, and `no_active_recording`; do not infer mappings solely from illustrative names in the original proposal.

Retain native receipt data when normalizing rejected outcomes. Either carry the receipt in the typed failure or model terminal native outcomes as a discriminated result. Do not replace structured rejection responses with a generic string during a behavior-preserving refactor.

Private causes may be retained internally, but must not leak through MCP responses or default error logging. Distinguish expected failures, defects, and interruption at the adapter boundary.

### Acceptance

- Domain tests assert specific failure tags without running an MCP server.
- Boundary tests retain the existing valid/invalid input cases and verify the generated MCP input schema. Invalid input cannot reach persistence, and diagnostic messages cannot disclose note content.
- Adapter tests assert exact successful, rejected, and uncertain response shapes.
- Connection initialization is not repeated per call.
- Native persistence and acknowledgement tests continue to pass.
- No private values appear in responses or diagnostics.

## Slice 3: Cancellation, timeouts, and tracing

### Work

- Define timeout configuration in one location while preserving the existing fetch and acknowledgement budgets initially.
- Connect the SDK request cancellation signal to Effect interruption using the installed SDK and Effect APIs.
- Extend native operations to accept cancellation where safe: HTTP requests and acknowledgement polling should stop when interrupted.
- Preserve short critical persistence sections and required durable bookkeeping before allowing interruption to complete.
- Do not assume wrapping a non-cancellable Promise with an Effect timeout stops its underlying work.
- Verify cancellation before admission, after admission, and during acknowledgement waiting. After admission, a later same-ID retry must inspect the existing request/receipt.
- Start without automatic write retries. Add them only for explicitly classified transient failures after proving that the same ID and text preserve terminal rejection and uncertain-admission semantics.
- Add spans for `mcp.log_work`, `harness.log_work`, `harness.discover`, and native requests as useful.
- Record only allowlisted operational fields, such as error tag, status, latency, and carefully selected identifiers. Do not serialize entire errors or inputs. Configure logging away from stdout before enabling it.

### Acceptance

- Broken native operations cannot leave a tool call waiting indefinitely within the supported cancellation boundaries.
- Cancellation stops cancellable work without duplicate writes or retroactive admission.
- A cancelled or timed-out call can still be acknowledged natively; the client receives no false rollback guarantee.
- Shutdown releases runtime resources and leaves durable requests recoverable.
- Tests confirm stdout remains MCP-only and diagnostics contain no note content or secrets.

## Initial file organization

Keep the first change small. A reasonable starting point is:

```text
integrations/codex/
  harness-mcp.ts          # SDK lifecycle, input schema, thin adapter
  harness-domain.ts       # services, domain programs, typed outcomes
  harness-native.ts       # Effect adapter over existing native helpers
  harness-tool-result.ts  # MCP conversion if large enough to justify separation
  harness-helper.ts       # existing native IPC and durable storage behavior
  harness-domain.test.ts  # isolated service/program tests
```

Split into `harness/`, `mcp/`, and `native/` directories only as additional tools justify it. Do not migrate unrelated Codex telemetry, legacy work-log integrations, schema libraries, pure utilities, or native Swift code as part of this slice.

## Verification and delivery

Before editing, read [verification.md](../verification.md), inspect the package scripts, and establish the relevant harness baseline. Preserve unrelated changes in the dirty worktree.

For each slice:

1. Run targeted domain/adapter tests appropriate to the change.
2. Run the integration package typecheck.
3. Build the harness and run its owning harness tests, including the standalone Node bundle checks used by macOS packaging.
4. Inspect the scoped diff and whitespace checks.
5. Report separately what unit tests, protocol tests, bundled execution, and any live-client check establish.

Do not claim real Codex/native-app compatibility from synthetic tests alone. Full macOS builds and physical-device checks are not default requirements for this TypeScript-only refactor unless packaging changes or failures make them relevant.

## Slice 1 implementation evidence — September 26, 2026

Working-tree scope: `integrations/codex/harness-mcp.ts`, its stable `.mjs` entry, and `harness-helper.test.mjs`, plus this plan and the current-plan status entry. Existing native/helper persistence, input validation, note descriptions and tool result content remain unchanged. No dependency or native Swift changes were made for this slice.

- `serveStdio` now owns era selection and lifecycle, using the existing `StdioServerTransport` with its 128 KiB limit.
- One invocation-owned binding shares pending resolution, retries failed resolution and retains successful resolution across discarded discovery probes and legacy fallback. Every tool listing and note still passes that expected identity to the native helper.
- `_wrapHandler` only gates `tools/list`; the application `initialize`/`ready`/`oninitialized` state machine was removed.
- Installed SDK behavior is now explicit in tests: claim-less legacy requests can run before `initialize`/`notifications/initialized`, and repeated legacy initialization is accepted. Neither can change native authorization. Factory failures produce the SDK's generic `Internal server error` response and a fixed stderr diagnostic; existing tool rejection/uncertain response content remains unchanged.
- Shutdown uses the SDK lifecycle handle. No Effect runtime or other connection-owned resources were introduced. EOF subprocess checks establish process exit and SDK framing behavior; they do not establish managed-runtime finalization for Slice 2. In the installed SDK, `StdioServerTransport.start()` does not register an input `end` listener, so any future runtime ownership must account for that explicitly.

Verification: the pre-edit harness baseline passed all 36 tests and the integration typecheck. The sandbox's initial test attempt could not bind loopback fixtures (`listen EPERM`); the authorized host run passed. The final `bun run --cwd integrations/codex test:harness` passed **44/44 tests**, with zero failures/skips, including the build and standalone Node bundles produced by the macOS resource script. Integration `typecheck`, scoped Biome checks and `git diff --check` passed. One intermediate run exposed an existing heartbeat fixture race (`EEXIST` between `rm` and `mkdir` in `harness-dev.test.mjs`); the final rerun passed without changing that test or its implementation. Two new test expectations were also corrected to assert only public receipt fields and to retain the test client's own readline error listener.

These checks establish synthetic protocol behavior, real loopback HTTP with synthetic native packets, explicit SDK-handle closure and standalone Node execution. No live Codex/native-app compatibility or signed distribution check was performed.

Schema follow-up: installed Effect `4.0.0-rc.112` and MCP server `2.0.0` source inspection, plus a disposable smoke check, confirmed that a combined Effect Standard Schema registers as an MCP tool, validates types, rejects excess properties with explicit parse options, and generates `additionalProperties: false`. The full note schema migration and boundary regression checks are now implemented in Slice 2 below.

## Slice 2 implementation evidence — September 26, 2026

Working-tree scope: new `harness-domain.ts`, `harness-native.ts`, `harness-tool-result.ts` and their three `.test.ts` files; updated `harness-mcp.ts`, `harness-helper.test.mjs`, integration `package.json`/`tsconfig.json`, `bun.lock` and the two plan documents. The native helper's persistence and IPC implementation is unchanged.

- `LogWorkInput` is one Effect Schema, exposed to MCP through Standard Schema validation and JSON Schema conversion. It preserves the original UUID grammar (including uppercase and non-version-specific UUIDs), exact note text, whitespace/UTF-8/well-formed-Unicode checks, descriptions, annotations and advertised constraints. Excess properties are rejected explicitly. Validation responses now use a fixed explanation so submitted values and unexpected property names cannot leak through issue formatting.
- `HarnessClient` and `HarnessConnection` use Effect v4 `Context.Service`. Connection resolution, discovery and `log_work` run as domain programs without MCP imports. The native adapter supplies a stateless `Layer.succeed`; the immutable resolved identity is injected through a second value layer. No effectful layer dependency is hidden behind a merge.
- Successful resolution still belongs to the invocation binding, is shared across SDK probe/fallback instances and is never repeated by a tool call. Both layers contain values only: there is no managed runtime, background fiber or resource acquisition requiring shutdown disposal. Existing SDK close/EOF subprocess tests continue to pass; future cancellable work must still handle the installed SDK's EOF limitation in Slice 3.
- Expected helper failures and native outcomes have explicit tags. Structured rejected/unconfirmed receipts remain attached to failures and retain their public `status`, `reason` and `nativeReceivedAt`. The adapter projects receipt fields before returning them. Unrecognized exceptions remain defects; defects, interruptions and failures without receipts all produce the original conservative MCP message without raw causes.
- Effect `4.0.0-rc.112` is declared directly in the integration; its direct Zod dependency is removed. The MCP SDK's internal Zod dependency remains. The new Node TypeScript tests run through `test:harness-domain`, which is included in the owning harness/capture/test scripts and integration typecheck.

Verification environment: Bun `1.4.0`, Node `v24.15.0`, Effect `4.0.0-rc.112`, MCP server `2.0.0`. All inputs and native packets used here were disposable fixtures.

| Check | Result and boundary |
| --- | --- |
| Pre-edit `test:harness` | 44/44 passed on the Slice 1 working tree. |
| `bun run --cwd integrations/codex test:harness-domain` | 33/33 passed: typed failures, service injection, exact schema, native exception classification, receipt projection, exact MCP outcomes, defects and interruption sanitization. |
| `bun run --cwd integrations/codex test:harness` | 33/33 domain tests plus 45/45 owning harness tests passed; includes the harness build, real loopback HTTP with synthetic native ACKs, identity/retry/persistence behavior, both protocol eras, input boundaries/privacy, SDK shutdown and standalone Node bundles from the macOS resource script. |
| Integration typecheck and scoped Biome | Passed, including the new TypeScript tests. |
| Frozen lockfile install and scoped diff/whitespace review | Passed; dependency changes are limited to this integration's direct Effect/Zod entries and its unused Zod lock entry. |
| Live Codex/native-app compatibility, full macOS build, signed distribution | Unrun; synthetic tests and standalone bundles do not establish those acceptance boundaries. |

## Slice 3 implementation evidence — September 26, 2026

Working-tree scope: new `harness-policy.ts`, `harness-execution.ts` and execution tests; updated native adapter, helper, MCP entry point, domain span name, harness tests, package test script, README and plan status.

- `harness-policy.ts` centralizes the existing three-second HTTP, ten-second acknowledgement and 50 ms polling budgets. No automatic write retries were added.
- SDK `context.mcpReq.signal` reaches Effect interruption. Already-cancelled dispatches never start native work. Once an attempt starts, HTTP and polling accept cancellation, while short persistence sections and lost-response bookkeeping finish before the Effect adapter's cancellation finalizer completes. Existing admitted requests and receipts are preserved; an unadmitted attempt retains its terminal rejection and ID/text digest.
- Invocation-owned execution tracks running programs and awaits their finalizers on close. Explicit close, input/output failure, and SIGINT/SIGTERM stop cancellable work. The SDK's missing stdin EOF handling is covered by a one-second drain period before transport closure, preserving ordinary buffered command processing. SDK framing, protocol negotiation and cancellation-response suppression remain authoritative. Filesystem operations are deliberately not forcibly timed out.
- Tracing is opt-in through `WELLSPENT_HARNESS_TRACE=1`, with local JSON output on stderr only. The exporter projects fixed span names, duration, status and allowlisted failure tags; it excludes inputs, receipts, identifiers, paths, credentials, raw causes and cancellation reasons. General-purpose Effect loggers are disabled. A failing trace sink cannot change the operation's outcome.
- Cancellation is not a rollback guarantee. Tests prove both sides of admission during a lost HTTP response, cancellation while awaiting native ACK, a later native ACK after cancellation/timeout, and recovery using the unchanged ID/text. Shutdown tests verify bookkeeping before subprocess exit, durable pending requests, and listener cleanup.

| Check | Result and boundary |
| --- | --- |
| Pre-edit `test:harness` | 33/33 domain tests and 45/45 owning harness tests passed. |
| `bun run --cwd integrations/codex test:harness` | 37/37 domain tests and 61/61 owning harness tests passed, zero failures/skips. Includes the harness build, cancellation/timeout/shutdown tests, stderr privacy, SDK framing and standalone Node bundles from the macOS resource script. |
| Integration typecheck and scoped Biome | Passed. |
| Live Codex/native-app compatibility, full macOS build, signed distribution | Unrun; local fixtures and standalone bundles do not establish these acceptance boundaries. |

All three implementation slices are complete. Preserve the independent C4 product acceptance gates in the current plan.

## Deferred extensions

Automatic retries, external tracing export, process-runner abstractions, sockets/watchers, timeline ingestion, indexing, sync, and other integrations remain separate work. Use scoped acquisition/release when real resources are introduced; avoid placeholder abstractions for hypothetical resources.

## References

- [MCP SDK modern-protocol migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
- [serveStdio lifecycle API](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/serveStdio.html)
- [SDK factory contract and probe behavior](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/createMcpHandler.html)
- [Effect v4 service migration](https://github.com/Effect-TS/effect/blob/main/migration/services.md)
- [Effect runtime ownership](https://effect.website/docs/v4/runtime)
- [OpenAI reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning)
