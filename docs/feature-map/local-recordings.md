# macOS local recordings

## Sub-features

Foreground application capture with start, pause, resume, finish, saved recording list, timeline, coverage gaps, and delete. The UI also has a **Developer samples** menu for synthetic local events.

## How to get to it (user POV)

1. Launch WellSpent. **Local Recordings** occupies the main Timer window below the timer. **Workspace → Local Recordings…** or `⌘⇧R` opens that main window.
2. Choose **Start recording**, or use the main timer **Start/Resume** to start/resume foreground recording alongside the stopwatch. Use **Pause recording** / **Resume recording** / **Finish recording** in the Local Recordings header. The main timer **Pause** stops new capture.
3. Select a row under **Saved local recordings**. The right pane shows status, interval/observation counts, task selection history, and **Timeline**. Expand an event's **Details** for its time basis and source. After finishing, **Delete recording…** is available below review.

## Prerequisites

Run the macOS app with its local recording store available. No account or API is needed for local foreground recording. Use a disposable recording for actions that create observations or delete history; keep an unrelated active recording intact.

## Observable check

- A newly started recording appears in the list. Switching foreground apps during an active interval should create application observations in the selected timeline. Pause should close the interval; resume should start a new interval. Finish should preserve the saved review after relaunch.
- Verify coverage and UTC time labels before interpreting an event. For persistence/recovery, compare the same local recording ID after reopening the app. Follow [native verification](../verification.md#synthetic-macos-recording) for the evidence boundary.

## Gotchas

- **Developer samples** are synthetic and must be reported as such. A timeline observation is exposure/metadata, not proof of attention, completion, or a synced Focus event.
- **Delete recording…** removes local evidence; use only in an explicitly disposable verification recording. **Reset** on the stopwatch preserves recording history.
- Local recordings are stored on this Mac and are currently unencrypted. Codex notes and automatic metadata need separate [connections](recording-connections.md).
- Source: [main window](../../apps/macos/TimerMac/Features/Stopwatch/TimerWindowView.swift), [recording window](../../apps/macos/TimerMac/Features/Recording/RecordingWindowView.swift), [controls](../../apps/macos/TimerMac/Features/Recording/RecordingControlsView.swift), [timeline](../../apps/macos/TimerMac/Features/Recording/RecordingTimelineView.swift).
