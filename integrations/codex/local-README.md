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
node integrations/codex/local-helper.mjs cleanup counts
node integrations/codex/local-helper.mjs cleanup temporary
```

Receipt cleanup permits a repeated hook to be queued again; the native immutable event identity still prevents duplicate recording evidence. Temporary cleanup removes unpublished temporary files and dead-process lock candidates, never published pending packets. Before retiring a binding, let pending reports finish delivery and review/clean up its quarantine. Then **revoke that binding in the native app** and explicitly run:

```sh
node integrations/codex/local-helper.mjs retire BINDING_UUID
```

Retirement refuses a binding with any pending or quarantined packet. It never deletes pending reports; revoking a binding that still has pending reports intentionally leaves those reports retained for explicit owner handling. It removes only the selected key bundle, preserving the sender identity, other bindings and content-free receipts. Retire unused bindings to stay below the 128-binding limit. After all bindings are retired, a subsequent pairing can select a new endpoint while retaining the sender ID. Retirement does not itself revoke the native grant. Immutable setup rejects attempts to change an existing binding's key, scope or association.

Binding keys remain private in the helper root until explicitly retired by its owner. Native revocation/deletion stops acceptance independently of helper retention. Retention has bounded counts, not automatic expiry; removing the entire root is a separate explicit destructive action.

Allowed metadata is opaque IDs, hook/tool names, reported result, hook receipt time and an explicit unknown occurrence time. Prompts, prose, arguments, output, cwd, transcript paths, URLs and tokens are excluded. “Reported success” does not establish human focused time or verified completion. Local privileged access or stolen pairing keys are outside this trust boundary.

## Verification

```sh
node --test integrations/codex/local-helper.test.mjs
```

Tests use synthetic input and disposable private directories, real loopback HTTP and helper subprocess kills. They do not install hooks, launch a signed app, read private transcripts, or submit remote data. Live selected-session acceptance is tracked in `docs/design/2026-09-13-c3b-local-codex-intake.md`.
