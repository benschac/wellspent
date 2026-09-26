# Local Codex intake (opt-in)

This helper queues metadata for an explicitly paired Codex thread and Mac recording interval. It serves only the paired literal `127.0.0.1` port; the Mac app pulls and commits reports locally, then signs a receipt. The helper never opens the native database, reads transcripts, or calls an upload API. Existing `timer-capture.mjs`, its cloud account destinations, queue, event namespace, and configuration remain separate.

`local-hooks.example.json` is an **inert, machine-specific preparation file**, with the Node executable and checkout paths verified September 13, 2026. It is not an installed hook. Install only after explicit authorization for the selected known thread and after native pairing while that interval is active. Both hooks run synchronously for durable enqueue with a five-second timeout; capture emits `{}` and exits successfully even when intake is unavailable, so it cannot block Stop. No global “current session” association is used.

## Pair and run

The default private root is `~/.config/wellspent/codex-local/` (directories 700, files 600). It must be outside the checkout. A disposable alternative may be supplied as `--root /private/tmp/example` **before** the command. Do not share a root or endpoint with another application.

```sh
node integrations/codex/local-helper.mjs identity
node integrations/codex/local-helper.mjs setup
node integrations/codex/local-helper.mjs serve
node integrations/codex/local-helper.mjs status
```

`identity` durably creates/reports the stable sender ID. Use that ID, the exact thread ID, and a literal loopback port (default UI selection 43871) when pairing in the Mac app. `setup` accepts the Mac app's JSON pairing bundle **only through stdin**, then EOF; never pass the key as an argument or save it in repository configuration. First setup can adopt a native-issued sender ID if no helper identity exists. Subsequent bindings must preserve that sender and endpoint. Each Resume requires a new native binding; setup never changes the first packet for a known invocation. Keep `serve` running; Ctrl-C stops it without draining the queue. Pending reports survive helper/app restarts and are eligible only after the native interval has a known end.

For clipboard import, prepare `pbpaste | node integrations/codex/local-helper.mjs setup`
in the terminal first, then copy the **entire JSON bundle** from Timer and execute
the prepared command. Copying the shell command afterward replaces the bundle on
the clipboard. `Setup input is not valid JSON` means parsing failed before any
pairing change; it does not call for revocation or another newly created grant.
Copy the existing displayed bundle again, including its opening and closing
braces, without labels or code fences. Hide the bundle after successful import.

## Status and retention

Status exposes pending, quarantined and unassociated counts plus content-free reasons. Unassociated/missing-identity hooks create no event packets; they update counters and the bounded metadata-only checkpoint below. Quarantine retains only previously normalized metadata and a fixed rejection reason. Open intervals and unavailable native storage remain pending. Quarantined packets cannot be silently rebound.

### Diagnosing a live hook

`capture-diagnostic.json` in the private root is one bounded, atomically replaced
checkpoint (mode 600), separate from the native status protocol. It contains only
an attempt ID, process ID, hook receipt time, stage, fixed code and validated
opaque hook/thread/turn/invocation/event IDs. It never contains hook input,
arguments, results, prose, transcript paths or pairing keys. Concurrent hooks may
replace each other's latest checkpoint; it is a diagnostic, not an event history.

- `stdin / waiting_for_input`: the configured Node helper launched and opened the
  private root; it has not finished reading and parsing stdin.
- `capture / input_parsed`: stdin reached EOF and parsed; normalization/spooling
  has not yet returned.
- `complete / queued`: the immutable signed pending packet was durably published.
  `duplicate` means a prior pending packet, receipt or quarantine already exists.
- `complete / unassociated`: hook delivery worked, but that exact thread has no
  eligible binding. Compare the checkpoint thread ID with the native pairing.
  Starting another Codex thread does not inherit the original thread's grant.
- Other completion codes retain the existing fixed exclusion reasons. Failure
  codes identify invalid/empty/oversized stdin, invalid private storage, denied or
  full storage, or unavailable capture. Errors before private-root initialization
  appear only on hook stderr as `wellspent_capture:<fixed_code>`.

Diagnostic writes are best effort and never block capture; failures emit only
`wellspent_capture:diagnostic_unavailable`. Capture still returns `{}` and exits
successfully. The existing helper server reads pending files on every poll, so
editing capture diagnostics does not require restarting it or changing hook trust.

Run one benign real tool call such as `pwd`, then inspect the checkpoint and
pending/receipt counts. A `/hooks` trust listing or generic hook start/completion
notification alone does not prove this handler ran. Resume in Timer creates a new
interval and requires a new explicit pairing/import; it does not update an old
grant. An open interval should retain packets as pending. Pause or Finish permits
eligible reports to commit, appear in Timer, and be ACKed. Do not synthesize input
or rebind an old packet to claim live acceptance.

Limits are 1,000 pending packets, 1,000 quarantined packets, 10,000 content-free ID receipts, 128 binding bundles and 4,096 short-lived replay nonces. Each private JSON file/wire request is capped at 16 KiB; event bodies at 8 KiB, raw hook stdin at 1 MiB. At capacity, capture increments `queue_full` and excludes new packets; full receipt/quarantine storage prevents deletion of pending bytes. No old entries are silently evicted. Nonces are durably recorded before serving data and expire after their replay window.

Explicit cleanup deletes the selected local category:

```sh
node integrations/codex/local-helper.mjs cleanup quarantine
node integrations/codex/local-helper.mjs cleanup receipts
node integrations/codex/local-helper.mjs cleanup telemetry-receipts
node integrations/codex/local-helper.mjs cleanup counts
node integrations/codex/local-helper.mjs cleanup temporary
```

Receipt cleanup permits a repeated hook or telemetry observation to be queued again; the native immutable event identity still prevents duplicate recording evidence. Telemetry receipt cleanup leaves pending observations intact and can free the 10,000-receipt limit after delivery. Temporary cleanup removes unpublished temporary files and dead-process lock candidates, never published pending packets. Before retiring a binding, let pending reports finish delivery and review/clean up its quarantine. Then **revoke that binding in the native app** and explicitly run:

```sh
node integrations/codex/local-helper.mjs retire BINDING_UUID
```

Retirement refuses a binding with any pending or quarantined packet. It never deletes pending reports; revoking a binding that still has pending reports intentionally leaves those reports retained for explicit owner handling. It removes only the selected key bundle, preserving the sender identity, other bindings and content-free receipts. Retire unused manual bindings to stay below the 128-binding limit. Automatic capture retires stopped bindings after their queues drain, including on a later enrollment if delivery finishes after Stop. After all bindings are retired, a subsequent pairing can select a new endpoint while retaining the sender ID. Retirement does not itself revoke the native grant. Immutable setup rejects attempts to change an existing binding's key, scope or association.

Manual binding keys remain private in the helper root until explicitly retired by their owner; stopped automatic binding keys remain until their queues drain. Native revocation/deletion stops acceptance independently of helper retention. Retention has bounded counts; removing the entire root is a separate explicit destructive action.

Allowed metadata is opaque IDs, hook/tool names, reported result, hook receipt time and an explicit unknown occurrence time. Prompts, prose, arguments, output, cwd, transcript paths, URLs and tokens are excluded. “Reported success” does not establish human focused time or verified completion. Local privileged access or stolen pairing keys are outside this trust boundary.

## Verification

```sh
node --test integrations/codex/local-helper.test.mjs
```

Tests use synthetic input and disposable private directories, real loopback HTTP and helper subprocess kills. They do not install hooks, launch a signed app, read private transcripts, or submit remote data. Live selected-session acceptance is tracked in `docs/design/2026-09-13-c3b-local-codex-intake.md`.

## Explicitly selected telemetry source (disabled by default)

The separate `selected-telemetry-reader.mjs` command can read one explicitly
selected Codex 0.157.1 file from an exact EOF. `serve`, hooks and native launch do
not enable it. Obtain a fresh file/window/output/retention authorization before
using a real session; prior live checks grant no continuing access.

Commands take an explicit private helper root (with an imported native pairing):

```sh
node integrations/codex/selected-telemetry-reader.mjs /absolute/private/helper-root select < selection.json
node integrations/codex/selected-telemetry-reader.mjs /absolute/private/helper-root read
node integrations/codex/selected-telemetry-reader.mjs /absolute/private/helper-root status
node integrations/codex/selected-telemetry-reader.mjs /absolute/private/helper-root pause
node integrations/codex/selected-telemetry-reader.mjs /absolute/private/helper-root resume < new-selection.json
```

Selection JSON requires `filePath`, `eofOffset`, `bindingID`, `sessionID`,
`sourceVersion` (`0.157.1`) and `endsAt` (canonical UTC ISO, at most five minutes
away). Supply values explicitly; never search history or derive a filename from
an ID. Version/session are declared by the selection; no historical header is
read. EOF must still match and end at a newline. Resume needs a fresh EOF and the
appropriate explicit interval binding; excluded pause bytes appear as a gap.

Each `read` does at most 256 KiB / 64 complete records, with a 64 KiB line limit.
Partial lines wait. Status reports bounded-read/partial/error states, counters,
gaps and publication recovery. A new command process records a restart gap;
there is no background watcher. Expiry/pause prevents new source reads, while
already-journaled metadata can finish durable publication. The native app still
controls grant/interval admission and ACKs. The reader never writes SQLite.

State and allowlisted observations persist privately under `selected-reader`;
normal v1 cleanup does not delete them. Do not manually delete a pending journal
or receipt to clear an error: that discards recovery/deduplication evidence.
Conflicts, source changes and limits require inspection and explicit reselection
or retention decisions. See the [reader contract, synthetic checks and pending
live proposal](../../docs/design/2026-09-26-c4-selected-source-reader.md).

### Native opt-in selected telemetry

The existing `bun run dev:harness` terminal supervisor now accepts explicit native
telemetry requests through its private mailbox. In Timer, start recording, open
**Connections → Advanced diagnostics — selected Codex source**, enter one exact path/session/thread,
version-compatible current EOF and helper port, then **Authorize selected source**.
The fixed native window is three minutes and 2 MiB, including boundary and anchor
reads. No hook or MCP installation is needed. The supervisor imports the native
binding into its private `telemetry` subdirectory and runs the original local
helper HTTP server for queued delivery. Only explicit active native requests call
the original reader; there is no background source watcher.

Pause/Finish immediately revokes the private read permit. Queued observations can
still drain through v2 and native commit-before-ACK. A restarted supervisor serves
saved queues but has no source authorization. Explicit activation always requires
a fresh native binding and current EOF. A source switch retains the original
observation ledger and pending packet bytes. No telemetry gap is imported as a
native observation. Existing v1 and MCP delivery stay independent.

### Automatic capture inside an opted-in recording

Root `bun run dev` already runs the same harness supervisor. In **Connections →
Codex activity**, authorize a narrow session directory through the system picker.
Enable **Include Codex activity**, then Start recording. No hook, per-instance path,
ID, EOF, or pairing entry is needed. The native app issues a fresh grant for each
discovered source and interval; the helper establishes its EOF after that grant.
New-session startup, enrollment and pause gaps are excluded, not backfilled.

`automatic-telemetry-reader.mjs` enumerates only the selected root and numeric date
subdirectories to depth three: at most 512 entries per pass and 16 enrolled
sources. It reads the first header in 256-byte chunks to a 64 KiB ceiling, retaining
only identity/version plus a header integrity hash. Sources have independent
`automatic-readers/<physical-identity-hash>` state, journals and observation
ledgers. They share the original `telemetry-pending`, receipts, bindings and HTTP
server. Each source has a 2 MiB read budget; an authorization has a 64 MiB overall
budget and eight-hour ceiling. Existing queue/binding limits remain authoritative.

Native renews a process-bound 15-second lease only during active opted-in consent.
Expiry cannot be reversed by rewriting the old permit. Pause/Finish/Stop/revoke
fence discovery and reads; eligible queued metadata may still commit afterward.
Explicit Resume or Restart creates fresh bindings and EOF baselines. A helper
restart requires fresh native authorization; app reopen stays inactive. Directory
revoke removes setup, while the separate pairing revoke controls native admission.

Unsupported headers, permission loss, replacement and exhausted limits are
visible. A changed file is not silently enrolled as a replacement during the same
authorization. No linked-session traversal, raw content retention, totals or task
inference is added. Metadata and receipts persist locally until explicitly cleaned
up; only drained automatic binding keys are retired. See the [automatic capture evidence](../../docs/design/2026-09-26-c4-automatic-session-capture.md)
for synthetic HTTP/native results and remaining input/live acceptance.


### Assigned chat names in the timeline

Loaded-session discovery includes the App Server's optional `thread.name` in new
telemetry observations. Only a nonblank name of at most 500 UTF-8 bytes without
control characters is accepted; `preview` and conversation bodies are never a
fallback. The signed optional `threadName` field persists with the original
observation. Renames affect later observations; retries retain the first packet.
Existing unnamed packets and manual/directory-only sources keep generic labels.
Upgrade the native app and restart the helper together; older native parsers
reject the new field. Existing saved observations are not backfilled.
