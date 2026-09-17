# Mac timer controls and local recording — September 14, 2026

The user requested that pressing the Mac timer's Start/Pause control also control
background recording. This supersedes the earlier requirement for a separate
recording-button action, while preserving separate local recording storage and
shared stopwatch synchronization.

## Behavior

- Main-window Start/Resume and floating-widget clicks use the same
  `TimerRecordingController`, wired by `TimerAppComposition` through
  `TimerSidebarController`. Start creates a foreground recording or resumes the
  existing one. An already active foreground recording is reused. A sample
  recording must be finished explicitly before starting real foreground capture.
- The timer starts only after the recording's start/resume boundary commits.
  Startup can be cancelled. Pause immediately revokes intake and appends its
  timestamped boundary behind in-flight writes, including a pending start/resume.
  Rapid cancellation cannot start the timer after the save returns.
- Failed saves retain their original event identity. Pausing after a storage
  failure preserves the unknown coverage gap repaired by the existing retry flow.
  Retry alone does not restart the timer or authorize new capture.
- Reset retains its existing elapsed-time behavior and does not erase or finish
  recordings. Local Recordings retains explicit Pause/Resume/Finish controls.
- App relaunch, sleep recovery and remote stopwatch snapshots do not authorize
  capture. A remote stopwatch state can differ from local recording state; the UI
  displays recording status independently. Local Start/Resume is required to
  resume capture after a gap.
- Foreground capture still stores only app name, bundle ID and PID on this Mac.
  Existing Codex pairing and AI Harness connection requirements remain. This
  change does not install hooks, reconnect a harness, widen capture or upload data.
  Existing paired metadata delivery can still commit late reports for closed
  intervals; Pause stops new local capture, not previously authorized delivery.

## Changed scope

Based on `5529b58` plus the existing dirty worktree. The new controller and focused
tests live in `apps/macos/TimerMac/Features/Stopwatch/TimerRecordingController.swift`
and `apps/macos/TimerMacTests/TimerRecordingControllerTests.swift`.
`RecordingModel.pauseFromTimer` owns queued pause boundaries. Composition, sidebar,
main timer and compact views route actions and render capture status/errors; the
drag surface exposes recording semantics in its tooltip and accessibility help.
`TimerAppCompositionTests` verifies the production button routing. The README and
current plan describe this behavior. No schema, dependency, backend or harness
configuration changes were made by this task; pre-existing changes are preserved.

## Verification

Environment: macOS 26.3 (25D125), local Debug Xcode target with
`CODE_SIGNING_ALLOWED=NO`. The sandboxed test attempt failed before compilation
because it could not write Xcode/SwiftPM caches; tests were rerun with normal host
cache access.

- `bun run --cwd apps/macos lint`: passed.
- Initial full native test run: passed, including recording/controller tests.
- Final `bun run --cwd apps/macos test` after the failed-save coverage fix:
  **241 tests / 343 executions passed, zero failures or skips**. Result bundle:
  `apps/macos/.derivedData/Logs/Test/Test-TimerMac-2026.09.14_13-32-04--0400.xcresult`.
- `git diff --check`: passed.

The controller tests exercise start/pause/resume/reset, reuse of an existing
foreground recording, sample-recording exclusion, cancellation before work starts,
pause during start/resume and observation saves, failed startup/retry, failed
observation recovery, lifecycle suspension, relaunch and remote snapshot isolation.
Repositories are disposable fixtures; no live user recording or remote backend is
used by the new tests.

Live clicking/app-switch inspection, VoiceOver/keyboard acceptance and signed
distribution have not been performed for this wiring. In an updated build, start
from the main window, switch a selected non-sensitive app, pause using the widget,
inspect the interval and exclusion, then resume and verify the next interval.
Preserve current recordings and pending work. C4a's new-session `log_work`
acceptance and C2 formal evidence remain separate gates in the current plan.
