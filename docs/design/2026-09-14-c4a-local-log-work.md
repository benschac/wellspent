# C4a — Local `log_work` connection

September 14, 2026. Working tree based on `36884a7`. **Implementation and automated
verification complete; new-session/native interaction acceptance pending.**

## Behavior and ownership

The recording window has an **AI Harness** section. Connect opens a native
confirmation describing the installation and note scope. Only confirming Connect
invokes the supported `codex mcp add wellspent-local -- <node> <adapter> --root
<private-directory>` command. No key is placed in its arguments, the checkout,
or Codex configuration. The CLI and Node must already be installed. The command
form was checked against the installed CLI and [official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Registration records private ownership of the exact executable/arguments. Repair
can update an owned registration after the app moves; an unrelated server using
the same name is preserved and reported as an error. Incomplete installation is
a recovery error on app startup. Explicit reconnect after revocation rotates the
connection identity/key; previously running MCP processes cannot adopt that new
credential silently.

The app bundles the local adapter and its existing helper/contract dependencies
for unsandboxed development. The signed sandboxed app delegates approved setup
and server ownership to the package's `dev` supervisor, included in root `b dev`
(or `bun run dev:harness` alone). The terminal process can execute the installed
Node/Codex without weakening the app sandbox. Connection credentials and note
requests/receipts live in the app container's private
`~/Library/Containers/com.benjaminschachter.timer.macos/Data/.config/wellspent/codex-harness`
directory; unsandboxed builds retain `~/.config/wellspent/codex-harness` and their
app-owned helper. This is separate from C3's existing Codex hook pairings and
queues. Neither owner kills another process that owns the port. An authenticated
exchange establishes helper availability. A tool-list request establishes MCP
discovery; until that happens the UI says **Restart Codex required**. It does not
claim to add tools to an already-running session.

The dev supervisor publishes a private runner-specific heartbeat. Only a fresh
Connect/Disconnect request matching that runner can trigger setup/revocation;
restarting dev cannot replay an earlier pending request. The native UI waits for
a correlated result and validates the installed connection. Startup serves an
already installed nonrevoked connection, but never registers Codex, reconnects a
revoked identity, or starts recording. Missing dev-server errors direct the user
to start `b dev`. This is development orchestration, not signed distribution or
a packaged background-service installer.

The only MCP tool is `log_work`, taking an explicit UUID `id` and selected `text`
(up to 4096 UTF-8 bytes). It is an agent/user report, not verified completion or a
duration. Connecting does not install metadata hooks or read transcripts, prompts,
tool arguments/output, paths, or assistant responses automatically. There is no
hosted work-log dependency, token, observation upload, or schema migration.

## Admission and retry contract

1. Native polling publishes an authenticated active recording/interval and a
   process epoch. The helper's active heartbeat expires after three seconds and
   is forgotten on helper restart. It never authorizes a recording itself.
2. The first call preserves its UUID, exact text, submission time, connection,
   scope, recording, interval and process epoch in private durable storage.
   Inactive/offline calls receive a durable rejection identity, so retrying them
   cannot admit skipped work after recording resumes.
3. The native model verifies the authenticated body, connection scope, process
   epoch, request age (at most 15 seconds), and currently active interval. Its
   existing operation gate serializes intake with lifecycle boundaries. Notes
   already admitted before a suspension drain before the suspension boundary.
4. Only a committed SQLite note receives an acknowledgement. The event includes
   its original authenticated request bytes/digest and native receipt stamp.
   On a lost ACK or restart, an exact committed retry returns that original
   event, even when the interval has subsequently closed. Changed content under
   the same UUID is rejected. Uncommitted requests from an old native process
   epoch cannot be admitted following restart.
5. Helper receipts are durable before pending files are removed. A timeout is
   **unconfirmed**, never success. Retrying uses the original ID/text/body; it
   does not refresh association or the original submission time. Revocation
   blocks subsequent calls and preserves prior evidence.

The same local OS user owns both processes and the unencrypted private files;
this follows C3's trust boundary and does not isolate a compromised same-user
process. Each connection is tied to one explicit local scope. Foreground app
time and notes are never summed as focused human time.

## Changed files

- `integrations/codex/harness-helper.mjs`, `harness-mcp.mjs` and focused tests:
  registration, private state, authenticated loopback, MCP protocol, retries and
  revocation. Existing `local-helper.mjs` exposes its private storage primitives.
  `local-contract.mjs` permits a larger outer poll body for the nested signed
  note, retaining C3's default inner bound and the 16 KiB total wire limit;
  capture package scripts include the new tests.
- `integrations/codex/harness-dev.mjs` and tests, package/root scripts:
  package-owned dev supervisor, private explicit setup handoff, existing helper
  lifecycle, and Node PATH propagation for the Codex CLI shebang.
- `LocalHarnessContract`, `LocalHarnessTransport`, `LocalHarnessRuntime`:
  native contract, bounded authenticated HTTP, private command output and owned
  process lifecycle. `LocalCodexTransport` shares its existing bounded sender.
- `LocalHarnessModel`, `LocalHarnessView`, `RecordingWorkNote`, `RecordingModel`
  and `RecordingEvent`: explicit approval/status/revocation, active admission,
  durable original note metadata, and separate source semantics.
- `RecordingWindowView`, `TimerAppComposition`, `RecordingTimeline` and
  `RecordingTimelineEventView`: native composition and review of notes with
  submission/native receipt times.
- `scripts/macos-harness-resources.mjs` and the existing Xcode resource build
  phase bundle the adapter allowlist. Native domain/runtime/transport tests and
  the hosted window render cover the new slice.

Existing staged and unstaged user work, recordings, grants, hook installation,
queues and backend state are preserved. Nothing was staged or committed here.

## Verification

Environment: macOS 26.3 (25D125), Xcode 26.6 (17F113), Node v22.23.1, Bun 1.4.0.
Debug macOS target with `CODE_SIGNING_ALLOWED=NO` and the repository's
`-skipMacroValidation` test script. Initial restricted execution could not write
SwiftPM/Clang caches; the test command was rerun with normal host cache access.

- **Passed:** full `bun run --cwd apps/macos test`: 223 tests, 318 parameterized
  executions, zero failures/skips. Result:
  `apps/macos/.derivedData/Logs/Test/Test-TimerMac-2026.09.14_09-58-42--0400.xcresult`.
  This includes production Node HTTP → native recording admission → real SQLite
  commit/deduplication → authenticated helper ACK, plus inactive rejection,
  original-note retry after native model/repository restart, scope/epoch/identity
  rejection, owned-helper process restart, command cancellation and safe recovery
  status. The transport fixture invokes the adapter's local submission function;
  it is not a real Codex session.
- **Passed:** `bun run --cwd integrations/codex test:capture`: 23 Bun capture
  tests / 126 assertions, plus 29 Node tests (13 harness, 16 existing C3 helper).
  Covers MCP stdio, private installation fixtures, name-conflict protection,
  repair, inactive/offline rejection, stale/replayed requests, durable identity,
  lost-result retry, revocation/rotation/session pinning, and nested envelope
  size boundaries. Uses disposable state and local listeners, not live hooks.
- **Passed:** `bun run --cwd apps/macos lint`, targeted Biome on all seven
  affected JavaScript/package files, resource bundle import/syntax checks, and
  `git diff --check`.
- **Not run:** real `log_work` invocation from a newly started Codex session,
  interactive Connect/Disconnect and keyboard/VoiceOver traversal in the running
  app, signed distribution. An automated window render is not those checks.

The test image renderer does not fully render macOS GroupBox content. Its output
was inspected and does **not** establish the AI Harness section's visual
acceptance. Interactive visual/keyboard checks remain in the checklist below.
During fixture development, an import argument accidentally entered the helper's
CLI; the corrected fixture uses an inert argument and a canonical private temp
path. A read-only check found no files in the user's harness root: no credential
or registration was installed. Existing user state was not removed.

An interactive inspection attempt selected the repository's Debug app path, but
native automation reported multiple registered TimerMac Debug bundles and
repeated app-change safeguards. No Connect approval or recording control was
activated. This attempt is not visual/keyboard acceptance of the updated build.

## Selected live acceptance remaining

### Development startup repair verification

The September 14 repair passed full native tests: **231 tests / 332 executions,
zero failures/skips**. Result:
`apps/macos/.derivedData/Logs/Test/Test-TimerMac-2026.09.14_10-34-41--0400.xcresult`.
This includes the production dev runner with a disposable fake Codex executable,
native external Connect, authenticated poll, and Revoke. It proves the private
cross-language contract, not an installed Codex session or signed-app interaction.
The capture suite passed **23 Bun tests / 126 assertions and 40 Node tests**
(11 dev-runner, 13 harness, 16 C3 helper). Focused Biome, native Swift lint and
Turbo dry-runs passed; root dev includes the persistent uncached harness task.

A read-only live check found a healthy existing dev runner in the real app
container, with no connection or registration yet. Starting a second runner
correctly refused ownership; the existing process was not stopped. Restart the
user-owned dev command once to load the finished changes. Rebuild and rerun the
native app with Xcode (⌘R); restarting the server cannot update native code.

The user subsequently attempted Connect in the running app and supplied its
generic installation-failure screenshot. Read-only inspection found App Sandbox
enabled in the signed Debug app. Running the installed Codex executable with a
GUI-like system-only PATH reproduced `env: node: No such file or directory`.
The prior unsigned tests did not establish this signed-app setup boundary.
The development supervisor and explicit handoff address that boundary; a new
signed-app interaction remains required to establish the repaired live flow.

Run `bun run dev:harness` (or the full `b dev`) and keep it running.
Use an updated build without replacing an app that has unsaved work. In Local
recordings, inspect AI Harness, tab to Connect, and confirm the disclosed local
installation. Verify **Restart Codex required**, then start a new Codex session
and discover `wellspent-local.log_work`. Record build/signing identity.

Start a disposable local recording. Submit one non-sensitive note with a new
UUID, then retry the same UUID/text. Verify one timeline note and the original
submission/native receipt times. Pause; submit another UUID and confirm a visible
non-success result. Resume and retry that rejected UUID; it must remain rejected.
Repeat the inactive check for suspension, interruption/relaunch and finish.

For restart/retry, preserve the original ID/text through a helper interruption or
lost acknowledgement and confirm one committed event. Uncommitted work from a
previous native process must remain excluded after app restart. Disconnect and
verify later calls fail while earlier notes remain. Check keyboard focus,
confirmation cancellation, source/time labels, and the error/recovery guidance.
Only these observations close C4a's selected live/native acceptance. C2 formal
evidence and signed distribution remain separate.

The following C4 engineering slice is append-only annotations/corrections that
preserve original observations.


### September 16, 2026 live acceptance — partial

Checkout `68767722e2b7a5dd5bd7f2f31963df28b5c26721` plus the existing dirty
C4a/dev-runner work. macOS 26.3 (25D125), local development only. Selected
Xcode product: `~/Library/Developer/Xcode/DerivedData/TimerMac-bdqwvbcnppjxyhdqfeerlizlrvvs/Build/Products/Debug/TimerMac.app`.
`codesign` reports ad-hoc signing, no TeamIdentifier, App Sandbox and network
client entitlements. This is not signed-distribution acceptance.

- The app was already Connected and recording; this Codex session exposed the
  actual `wellspent-local.log_work` tool. Connect installation/discovery was not
  newly performed in this run.
- Note `28d13135-5a24-41b7-9e34-147d07dc1c6b` and its exact retry both returned
  `acknowledged/saved`, native receipt `2026-09-16T13:34:32.578Z`. Read-only SQLite
  verification found exactly one event, sequence 17, in recording
  `61E6AB06-AE03-4ED3-A6B3-78358E68F7D1`. Native accessibility inspection showed
  that note with reported-note/outcome-unverified, submission, and local-save
  labels.
- With user approval, finished the existing recording. Note
  `0164d285-57ad-4a11-90c4-7b9bcb67cfcc` returned
  `rejected/no_active_recording`; SQLite contained zero events for that ID.
- Restarted the identified repository dev supervisor with `bun run dev`; output
  confirmed the dev runner ready and local helper running. Retrying the original
  committed note returned its original acknowledgement.
- Invoked Xcode Run (Command-R); Xcode subsequently reported Running TimerMac.
  Native UI automation then failed repeatedly with `native pipe closed before
  response`, including after a tool reset. This blocked disposable-recording
  creation and further native interaction; user handoff requested.

Pending: fresh Connect/cancellation/discovery, disposable-recording pause/resume,
suspension, interrupted/uncommitted admission across native restart, Disconnect,
and keyboard/VoiceOver acceptance. An already committed receipt retry does not
prove the uncommitted restart case. C4a remains partially accepted.

User-assisted continuation: the user started a disposable foreground recording.
Real note `7782823d-49e0-4b7a-b213-a5630c884daa` and its exact retry returned
the same `acknowledged/saved` receipt `2026-09-16T13:37:19.232Z`. Read-only
SQLite found exactly one event (sequence 5) in recording
`52A1AF94-12BD-4303-AA0D-DC7687DB052B`. Retrying the previously rejected
finished-state ID while this new recording was active remained
`rejected/no_active_recording`, with zero matching SQLite events. Thus the
finished-state rejection was not retroactively admitted. Pause/resume checks
remain next.

Paused check: after the user reported pausing, real tool call
`c27be064-d18c-4417-bc93-e77368a5d080` returned
`rejected/no_active_recording`; read-only SQLite found zero matching events.
The user also reported a Codex restart requirement; the existing session's tool
remained callable. The restart/discovery UI needs investigation before acceptance.
Retry of this paused ID after resume remains pending.

After the user reported resuming, an exact retry of paused ID
`c27be064-d18c-4417-bc93-e77368a5d080` remained
`rejected/no_active_recording`; read-only SQLite still contained zero matching
events. The paused rejection was not retroactively admitted.

Disconnect check: after the user reported Disconnect, new real tool call
`18d0b99e-67cf-48a8-af18-31e75b95d65f` returned
`rejected/connection_revoked`. Read-only SQLite confirmed zero events for this
ID and the paused/retried ID, and exactly one preserved event for disposable
recording note `7782823d-49e0-4b7a-b213-a5630c884daa`.

Selected real-tool checks now passed: exact retry deduplication, finished-state
rejection and retry during a new recording, paused-state rejection and retry
after resume, committed receipt retry after dev restart, and Disconnect with
prior evidence retained. Remaining gates: fresh Connect/cancellation/discovery,
restart-message recovery behavior, suspension, interrupted/uncommitted native
restart admission, and keyboard/VoiceOver checks. The test recording has not
been finished by the agent; the connection is revoked.
