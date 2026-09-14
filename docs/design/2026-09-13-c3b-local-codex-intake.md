# C3b — production local Codex intake

September 13, 2026. Implementation, synthetic verification and the selected ordinary-session capture/restart check are complete in the running Debug app. Real PostToolUse and Stop events survived an offline interval closure and helper restart, then committed once with unchanged bodies, ACKs and visible reports. Signed distribution and C2 formal acceptance remain separate. This entry follows the [C3a contract](2026-09-13-c3a-local-codex-intake.md); dated observations below preserve their original proof boundaries.

## Implementation scope

A separate Node helper under `integrations/codex/local-*` owns the local metadata outbox. The native app owns pairing, revocation and recording writes. Grants and event intake share the existing recording SQLite transaction boundary; recording deletion revokes its bindings in that transaction. The native app pulls authenticated packets from the paired literal loopback endpoint, preserves exact metadata and first native receipt, and ACKs only after commit. Polling starts only after recording recovery succeeds. New events wait for a known interval end; interruption, missing association, expired new input and identity conflicts never become timeline evidence.

The local recording window exposes explicit thread/interval pairing, revocation, helper-reported queue counts/reasons and local-only disclosure. Review distinguishes hook receipt, unknown occurrence, native receipt, and unverified reported results. Existing records decode without agent metadata. No installed hook/configuration, existing cloud spool, transcript, observation upload, dependency or entitlement is changed. The existing cloud normalizer additionally excludes local-helper invocations.

## Selected ordinary-session procedure

The reviewed configuration template is `integrations/codex/local-hooks.example.json`. It is inert in that directory. After explicit authorization, merge only its PostToolUse and Stop handlers into a selected configuration layer, preserving all other hooks/configuration and recording a backup. Recheck the installed harness version and its config trust/reload behavior first. Current official [Codex hook documentation](https://learn.chatgpt.com/docs/hooks) describes hook discovery next to active config layers, additive hooks across layers, and JSON output for Stop.

1. Identify the intended signed Timer binary/build, signing identity, sandbox status, macOS version and Codex harness/version. Do not quit or replace an app with pending work.
2. In a terminal, run `node integrations/codex/local-helper.mjs identity`. This creates only the separate private local helper state and prints its stable sender ID. Do not paste pairing capabilities into chat.
3. Select a non-sensitive ordinary Codex thread with a known thread ID. Start a local foreground-app recording in Timer. Expand **Local Codex activity**, enter sender ID, thread ID and port `43871`, then **Create pairing**. Pairing is saved before its bundle is displayed.
4. Run `node integrations/codex/local-helper.mjs setup` in a terminal, paste the private bundle into stdin and send EOF. Hide the bundle in Timer. Start `node integrations/codex/local-helper.mjs serve`. The helper stays in the foreground; no launch service is installed.
5. Activate only the reviewed metadata-only hooks after authorization. Produce a benign tool invocation and Stop in the selected thread. No transcript read or retrospective binding is needed. Confirm pending status while the interval is open, then Pause or Finish and inspect committed local events.
6. Exercise delayed delivery by stopping the helper while the interval ends and restarting it. Exercise duplicate/lost ACK and helper/app restart with the disposable selected recording. Verify one event per stable ID, unchanged original times, and reported-result labels. Relaunch interrupts open coverage; Resume requires a new explicit pairing, and old packets retain their old interval.
7. After delivery/rejection review, revoke the test binding and remove only the handlers installed for this test when done. `node integrations/codex/local-helper.mjs retire BINDING_UUID` then removes only that helper key bundle and refuses pending/quarantined reports; sender identity and receipts remain. Review helper status/quarantine before explicitly cleaning data. Receipt cleanup removes deduplication markers; do not replay old hooks after that cleanup.

## Verification evidence

Baseline: `d0d27ec58bfc474673448c1d94d5e2f942802fdc` plus preserved dirty work. New production files: `integrations/codex/local-contract.mjs`, `local-helper.mjs`, `apps/macos/TimerMac/Services/Recording/CodexIntakeContract.swift`, `LocalCodexTransport.swift`, and recording feature `LocalCodexIntakeModel.swift`/`LocalCodexPairingView.swift`. Existing recording event/snapshot/repository/model, review/control/window and app composition files integrate them. Added tests, extended the existing durability runner, registered capture/crash scripts and updated these handoff documents. The only change to the existing cloud adapter is local-helper self-exclusion, with a regression test. Existing unrelated changes and C3a prototype files remain intact.

Environment: macOS 26.3 (25D125), arm64, Swift 6.3.3, Node 22.23.1, Bun 1.4.0. Xcode Debug tests use `CODE_SIGNING_ALLOWED=NO`, resolved package versions and existing entitlements. No dependencies were added. Xcode's generated project formatting was restored to the initially clean project-file baseline.

| Executed check | Result and boundary |
| --- | --- |
| Full `xcodebuild ... test` | **Pass: 205 tests / 291 device test executions**, zero failures/skips. Result `apps/macos/.derivedData/Logs/Test/Test-TimerMac-2026.09.13_13-45-30--0400.xcresult`. Includes existing lifecycle/storage/window tests and new transport/contract/model tests. |
| Final focused native run after rejection handling changes | **Pass: 21 tests / 55 device executions**, zero failures/skips. Suites: `CodexProductionIntakeTests`, `LocalCodexModelTests`, `LocalCodexTransportTests`, `TimerAppCompositionTests`. Result `apps/macos/.derivedData/Logs/Test/Test-TimerMac-2026.09.13_13-48-08--0400.xcresult`. |
| `bun run --cwd integrations/codex test:capture` | **Pass: 23 legacy capture tests plus 13 Node local-helper tests.** Covers private durable setup, first-packet retention, immutable bindings/identity, Swift UUID interoperability, allowlisted metadata, bounded requests, replay, authenticated ACK/quarantine, concurrency, helper kills and safe selected-binding retirement. |
| `bun test integrations/codex/timer-capture.test.mjs integrations/work-log/work-log.test.mjs` | **Pass: 30 tests / 175 assertions.** Synthetic cloud compatibility/privacy checks; no upload to a live service. |
| `node apps/macos/scripts/recording-durability.mjs --codex` | **Pass: nine actual SIGKILL/recovery phases.** Four existing recording checks plus five C3b native boundaries: before write, during transaction, after commit, before ACK, after ACK. Each C3b scenario also kills/restarts its helper, using real authenticated HTTP and production SQLite source; verifies one exact event, original native receipt and durable ACK deletion. Unsigned disposable native worker, not the signed Timer app or ordinary Codex harness. |
| Swift strict formatting, new local helper/script/package Biome checks, JavaScript syntax, project plist and `git diff --check` | **Pass.** Broader Biome check on existing legacy capture files remains failing on pre-existing control-character regex rules and import order (plus template-string informational findings); these unrelated lines were preserved. |

The first native attempt was blocked by tool-sandbox compiler caches; approved host execution ran the tests. An intermediate full run failed eight transport fixtures because Xcode's PATH could not find Node; executable discovery was fixed and all reruns above passed. The startup composition fixture originally used the default unsandboxed repository: after startup began loading history, that test opened/migrated an empty unsandboxed `~/Library/Application Support/Wellspent/SyntheticRecording/recordings.sqlite` (zero recordings/events). It now explicitly injects an in-memory test fixture. The sandboxed user recording store was not modified by this test; only aggregate counts were inspected to verify the boundary. All C3b intake/transport/crash payloads and stores are synthetic/disposable. No ordinary session, live hook or transcript was used.

Final review also fixed uppercase/lowercase wire UUID interop, submillisecond pairing issuance precision, authenticated permanent-rejection quarantine, and explicit binding retirement. Invalid MACs cannot induce signed quarantine of otherwise valid packets. Native revocation/deletion and ACK dispatch share the model operation gate; database checks and writes are transactional across repository instances.

## Remaining acceptance gates

The exact authorized hooks remain installed and trusted. The selected live PostToolUse/Stop and pending-event restart checks now pass; see the final section. Full pairing UI/keyboard behavior, signed Timer distribution and C2 formal evidence remain separate acceptance work. Deliberately dropping an ACK to force a duplicate commit attempt is covered by synthetic tests, not claimed as a live test here. C4 timeline implementation can proceed; its usefulness/combined real-work acceptance is still separate.


## Approved hook configuration — September 13, 2026

The user explicitly approved activating the prepared metadata-only handlers. Installed the unchanged template at `.codex/hooks.json` in the already-trusted Timer project. This file did not previously exist. Used the installed Codex CLI 0.154.0 app-server protocol to discover and trust only those exact PostToolUse and Stop definitions. `hooks/list` returned both `enabled: true` and `trustStatus: trusted`; no trust bypass was used. Parsed configuration comparison verified that only two trust entries were added and all prior settings/hooks remain unchanged. Private original config backup: `~/.codex/config.toml.c3b-backup-20260913-140609`. JSON validation and diff checks passed.

The user's helper identity command returned sender `11a536cc-6b7c-4cbd-833a-16b3f099d2fd`. Current conversation thread ID, obtained from its runtime environment, is `01a09bd1-2024-7d80-8b35-03d7a93a0419`. These are available for explicit pairing in Timer; no pairing capability was read or shared in chat. At the initial check no helper pairing existed. No private transcript was accessed and no recording was automatically started. Configuration discovery/trust is verified; delivery in the already-running conversation is not yet observed. Complete pairing first, then verify the actual selected harness path (reload/resume the selected Codex thread if it has not picked up the new hook configuration). Live acceptance remains open.


## First selected live check — September 13, 2026

User completed helper identity/setup and started serve. Screenshot shows an active recording, the exposed old grant revoked and a replacement grant paired to this thread. Native status reports zero pending/rejected/unassociated. Read-only helper inspection confirms one matching binding, no pending/quarantine/receipts or count file, and active poll nonces. After the requested ordinary `pwd` tool call and completed assistant turn, no hook event has reached the helper. This proves pairing/poll connectivity but does not pass PostToolUse/Stop delivery; inspect the current CLI's `/hooks` view before retrying. Persisted trust was checked with an isolated app-server earlier, not the running thread's hook registry. Do not attribute this absence to interval closure: an open interval should retain pending reports.

Setup follow-up: added fixed, content-free CLI errors for empty/invalid JSON input, accidental arguments and invalid/mismatched pairing data. Clipboard validation printed only flags, never key/content; it showed command text at inspection time. Focused setup/capture tests passed, including no private-input leakage and unchanged capture fail-open behavior. This diagnostic improvement did not perform the user's pairing or submit fake live events.

## Live failure investigation — September 13, 2026, 18:44 UTC checkpoint

The subsequent debugging conversation is a **different thread**:
`01a09c0c-d0bc-74f2-8872-ce29f910c2cc`. Read-only Codex thread metadata identifies
both it and the earlier paired thread as CLI 0.154.0. The original thread predates
hook installation; this thread started afterward. A stale original runtime hook
configuration is a hypothesis, not an established cause: the inspected generic
`hook/started` and `hook/completed` notifications do not identify a handler or
provide its exit/result. No transcript was read to fill that evidence gap.

Verified boundaries in this debugging session:

| Boundary | Evidence |
| --- | --- |
| Configuration and launch | `.codex/hooks.json` still matches the authorized example. Its Node helper executes for ordinary tool calls in this thread without any hook/configuration change or restart. |
| Stdin and normalization | A real `pwd` completed successfully. The new private checkpoint recorded `PostToolUse`, this exact thread ID, an opaque invocation ID, `stage: complete`, and `code: unassociated`. This is real harness input, not a synthetic capture call. |
| Private storage | Existing native polls continue generating private nonces. Real hooks increment `unassociated` and publish mode-600 metadata checkpoints. Pending, quarantine and receipts remain empty because the thread has no eligible binding. |
| Pairing and interval | The helper and native database contain only the original thread's active grant, issued 18:13:07 UTC for interval `b645b950-d23d-4ca7-8f56-19cff092c44c`. Native history closed that interval at 18:27:49 UTC. Subsequent Resume actions do not change its association. The latest user Resume is persisted, but a pairing for this debugging thread has not yet been created/imported. |
| Native polling and reporting | Source inspection confirms authenticated polling, retention while the bound interval is open, commit/history reload before ACK, and report rendering after closure. Read-only live storage contains zero `agentCompletion` events. No live report-display pass is claimed. |

Added `capture-diagnostic.json`: one atomically replaced private checkpoint with
fixed stages/codes and allowlisted IDs only. It distinguishes waiting for stdin,
parsed input, durable enqueue/duplicate/exclusion and failures. Root-initialization
errors emit fixed codes on stderr. Diagnostic writes are best effort, preserve
`{}`/successful hook exit, and do not extend the running native app's strict
`status.reasons` contract. Existing pairings, queues, permissions, hook definitions,
the running helper and unrelated dirty files were preserved.

Validation: 14 Node helper tests pass when excluding the two existing loopback
server tests. The full attempt passed those same 14 and failed the two server
tests at `listen EPERM 127.0.0.1` under the tool sandbox; no permissions were
broadened. Tests cover real subprocess stdin/EOF checkpoints, immutable enqueue
and duplicate identity, malformed-input privacy, and capture despite diagnostic
write failure. Biome, Node syntax and diff whitespace checks pass.

**Live acceptance remains blocked at current thread/interval association.** Add
and import a pairing for this thread's active interval, preserving the original
grant. Then run another real tool call, verify its pending packet, close that
interval and verify the same event in native history/UI plus the helper receipt.
No restart is indicated by the current evidence. Diagnostics repair the
observability gap; they do not establish the cause of the earlier missing hooks
or bypass pairing checks.

## Recovery and real PostToolUse delivery — September 13, 2026

The user created a native grant for debugging thread
`01a09c0c-d0bc-74f2-8872-ce29f910c2cc` and active interval
`73506740-2468-46b0-9f51-5f878f34e583`. Their clipboard-to-setup command then
failed JSON parsing, before any helper pairing write. A diagnostic clipboard read
was unavailable in the tool sandbox; the clipboard contents and exact copy mistake
were not established.

Recovered the transfer by reading that one already-committed grant from the native
database read-only, validating its current thread, sender, endpoint and active
interval, and passing the same bundle to the existing helper `setup` command over
stdin. This was a one-time local recovery operation, not a new database-reading
helper feature. The key remained in process memory/private pairing storage and
was never printed, put in an argument, or saved in the repository. The helper
confirmed the exact new binding; hashes verified the previous identity and binding
files were unchanged. No native grant was created/modified by this operation.
The existing helper process picked up the new binding without a restart.

Executed a fresh ordinary `pwd` through the current session's real tool path:

| Observation | Verified result |
| --- | --- |
| Hook | `PostToolUse`, `Bash`, invocation `exec-cc99f6eb-7380-481f-8228-04ea3f348542`; hook receipt `2026-09-13T18:51:53.027Z`. The command returned the Timer checkout successfully. |
| Durable private queue | Checkpoint `complete / queued`; event `459402a7-d734-8c19-a573-e9cb98fe47b3` present in pending, no receipt or quarantine. It remained pending while the interval was open. |
| Closure | User hid the bundle and clicked Pause. Native boundary time `2026-09-13T18:52:58.744419Z`. |
| Native commit and ACK | The exact event exists once as `agentCompletion`, on the paired interval. Native receipt `2026-09-13T18:53:03.132304Z`. Pending file removed, content-free helper receipt present, no quarantine for this event. |
| Running Timer UI | Computer Use inspected the actual running build and scrolled the selected paused recording to the report. It visibly contains `Local Codex report`, `PostToolUse · Bash`, the same full event ID and hook receipt. `reportedResult` is conservatively `unknown`; occurrence is unknown and completion is explicitly unverified. |
| Later paused calls | Subsequent verification tools are quarantined as `outsideInterval`, with hook times after the pause. These explain the increasing rejected counter and are distinct from the accepted `pwd`. No counters/packets were cleared. |

Running artifact: Xcode Debug `TimerMac.app` at
`~/Library/Developer/Xcode/DerivedData/TimerMac-bdqwvbcnppjxyhdqfeerlizlrvvs/Build/Products/Debug/TimerMac.app`,
bundle `com.benjaminschachter.timer.macos`, version `0.0.0` / build `1`, arm64,
**ad hoc signature, no TeamIdentifier**, macOS 26.3 (25D125). This proves the
selected running Debug app, not signed distribution acceptance. The recording
was left paused and selected, with the report visible and bundle hidden.

Final helper suite: **16/16 pass**, including the two HTTP tests, using a scoped
host execution with disposable test roots/ephemeral ports. No persistent
permission setting or live pairing/queue changed for tests. Earlier sandbox-only
`listen EPERM` results above are superseded by this complete pass. Biome, JavaScript
syntax and whitespace checks also passed for the diagnostic changes.

The current capture blockage was resolved by restoring the exact thread/active
interval association and completing its failed import. The earlier pre-debugging
zero-count hook failure remains historically unproven; current success does not
identify which handler ran in those earlier generic notifications. Live Stop,
duplicate/retry across a live helper restart and signed distribution remain
separate C3b acceptance gaps. No setup repetition or restart is needed for the
now-delivered event.

## Reload follow-up — September 13, 2026

The user reported stopping the timer and reloading, with saved events still
present. A subsequent read-only query of the sandboxed native SQLite store
confirmed two committed `PostToolUse` reports for the debugging thread. The
verified `pwd` event `459402a7-d734-8c19-a573-e9cb98fe47b3` still exists exactly
once with its original hook receipt time, and its helper ACK receipt remains.
No duplicate event IDs or pending packets were found. Native recording boundaries
also include a Finish at 19:04:41 UTC, a new Start at 19:04:43 and an Interrupt at
19:05:33. The user's reload/UI observation is user-reported; the retained rows
and receipt were independently checked after that report.

Two real `Stop` packets for this thread are present in private quarantine with
`outsideInterval`; eleven `PostToolUse` packets had the same exclusion at this
snapshot. This verifies that the Stop handler reaches the helper and native
rejection path. It does not establish an accepted Stop report inside a paired
interval. Counts remain retained, not reset.

This supports saved-event durability after the reported reload. It does not
exercise a helper restart with unacknowledged packets: the verified reports had
already committed and been ACKed. Accepted Stop delivery, live pending/retry
recovery and signed distribution therefore remain separate acceptance checks.

## Pending-event helper restart and accepted Stop — September 13, 2026

**Pass for the selected live workflow.** The user followed the step-by-step test
in this same Codex thread. No native rebuild, hook change, permission-setting
change, packet injection, queue cleanup or grant revocation was needed.

Setup: active recording `a1eeb9c3-6c92-403a-abde-ffca0f45fb78`, interval
`6e5245a9-dca7-4789-9060-5f9f36bbde87`, resumed at 21:27:05.547573 UTC.
The UI had created six equivalent native grants for the same sender, thread,
endpoint and interval. Imported only the newest, binding
`b70a2366-0c85-4076-b986-0c914f230d2c`, through private stdin using its existing
native grant. Hashes confirmed prior helper identity/binding files were unchanged;
all native grants were preserved. No key was printed or stored in the checkout.

1. A real `pwd` produced PostToolUse event
   `c615332d-301e-8238-a918-f95421fae2a7`. Captured its pending packet/body hashes
   and verified no native row or helper receipt while recording was active.
2. Finishing the assistant turn produced a real Stop event
   `df96379d-9971-8d21-a198-f6f08f0412ce`, likewise pending with no native row.
3. User pressed Ctrl+C in the helper terminal. Read-only process checks confirmed
   original listener PID `34848` was gone and no process listened on port 43871.
   Both event packets remained byte-for-byte unchanged.
4. User paused Timer while the helper stayed offline. The exact interval closed
   at `2026-09-13T21:36:01.099744Z`. Both original packets were still pending,
   unchanged, unacknowledged, unquarantined, and absent from native history.
5. User restarted `local-helper.mjs serve`. New listener PID `44957` confirmed
   an actual helper process restart. Timer's existing polling recovered without
   reopening the recording or replacing the running native app.
6. Read-only SQLite/helper checks and the running Timer UI confirmed both exact
   events below. Each has one native row, its original stored body/hash, an ACK
   receipt, no remaining pending file, and no quarantine entry.

| Real event | Original hook receipt (UTC) | Native receipt after restart (UTC) | Result |
| --- | --- | --- | --- |
| `PostToolUse · Bash`, `c615332d-301e-8238-a918-f95421fae2a7` | 21:32:43.936 | 21:38:47.292028 | Exactly one row, unchanged body, ACK, visible in Timer |
| `Stop · Turn stop`, `df96379d-9971-8d21-a198-f6f08f0412ce` | 21:33:11.961 | 21:39:48.273607 | Exactly one row, unchanged body, ACK, visible in Timer |

Body SHA-256 values before shutdown and in committed native metadata matched:
`09ab2a9e4768427c872242b2bdf211c8dfc1220f2ea4a6fc4f471ca2578220ba`
(PostToolUse) and
`a0e2a0e5b1eb929e3e39790fb664bec29ca2c7004e8cea8c2569a621512d78cf`
(Stop). Reports retain unknown occurrence/reported outcome and unverified
completion labels. Native UI was inspected in the running Xcode Debug app at the
previously identified DerivedData path (PID `40110`), with the bundle hidden.
Collapsed the large pairing disclosure and scrolled the selected paused recording
to both reports. Left Timer paused/open and the restarted helper running.

Observed follow-up: five native grants were not imported into the helper, so
their polls reported unavailable. `LocalCodexIntakeModel` uses one global retry
delay (up to 30 seconds) and consumes one packet per binding per cycle. Those
failures therefore slowed delivery for the valid binding too. This was a delay,
not event loss: the exact pending events eventually committed and were ACKed.
The duplicate grants and tall status UI warrant a focused pairing/polling
follow-up; no automatic revocation or scope expansion was used to make this test
pass. Later calls made while paused continue to be excluded outside the interval.

This closes the requested live pending-event restart and accepted Stop checks.
It demonstrates delayed recovery with no duplicate saved rows in this scenario;
it does not claim a deliberately lost ACK or duplicate replay was injected live.
Existing synthetic duplicate/crash tests remain the evidence for those failure
points. The original earlier zero-count hook failure is still historically
unproven. Signed distribution and C2 formal evidence remain separate from this
Debug workflow pass. Only documentation changed during this final verification;
the prior 16-test helper result remains the code-validation evidence.

## Completion and commit verification — September 13, 2026

C3b is marked complete for implementation and the selected live Debug workflow;
C4's combined timeline is next. The commit includes native pairing, authenticated
intake and reporting, the private helper and diagnostics, C3a contract fixtures,
recovery tests and completion/verification notes. Only local-helper self-exclusion
and its regression test are included from the shared legacy capture files.
Unrelated cloud work-log changes and broader discovery/planning edits remain
unstaged. The installed machine-local `.codex/hooks.json` stays local; its reviewed
inert template is included. Pairings, queues and the running apps are preserved.

Fresh checks against the selected commit scope:

- **Pass:** exported indexed capture files, 18 Bun capture tests / 91 assertions
  and 22 Node tests (16 production helper, six C3a contract/outbox). This verifies
  that the commit does not depend on unstaged cloud work-log changes.
- **Pass:** focused native capture, composition, recording lifecycle and SQLite
  suites, 80 tests / 149 device executions, zero failures or skips. Xcode result:
  `apps/macos/.derivedData/Logs/Test/Test-TimerMac-2026.09.13_22-04-47--0400.xcresult`.
- **Pass:** targeted Biome (seven files), strict native Swift formatting and
  staged patch whitespace. No source changes followed these checks.

These checks supplement the real PostToolUse/Stop restart evidence above. They do
not extend it to signed distribution or deliberate live lost-ACK injection.
