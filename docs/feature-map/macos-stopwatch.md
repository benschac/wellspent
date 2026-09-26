# macOS stopwatch

## Sub-features

Shared stopwatch start, pause, resume, reset, elapsed readout, sync status, pending/unconfirmed actions, and API revision. The main Timer window and floating widget project the same timer state. Main Timer controls also coordinate local foreground recording.

## How to get to it (user POV)

1. Launch WellSpent. The main **Timer** window opens with elapsed readout, **Start** / **Pause** / **Resume**, **Reset**, connection status, and save status across its top row. Click the menu bar timer icon or choose **Workspace → Open Timer** to reopen it.
2. Click the floating timer face to start/pause. Its gear opens **Settings**; **Settings → Connection** shows the backend profile, status, active socket, and pending/unconfirmed actions. The main window's **Window options** shows the last server revision when available. The widget context menu also shows sync/save status.

## Prerequisites

The stopwatch can run locally, but a shared-sync check requires the intended local API/profile and its migrated database. Confirm **Settings → Connection** shows the expected socket before acting. Use a disposable local recording if Start/Resume will capture foreground app metadata.

## Observable check

- A validated server snapshot yields **Connected**; an open socket alone is insufficient.
- Start and watch elapsed time advance, pause and confirm it holds, resume and confirm it advances, then reset. Reset clears elapsed time while retaining running/paused state. In a synced check, wait for the specific action to be acknowledged before reporting a saved transition; inspect the revision in **Window options** and pending/unconfirmed counts in **Settings → Connection**.
- For restart/offline scenarios, use [the shared timer acceptance guide](../verification.md#shared-timer-sync-indicators) and record the visible status before and after reconnection. Closing the main window should leave the floating timer/service running.

## Gotchas

- Main Timer **Start/Resume** also starts or resumes local foreground recording. **Pause** stops new capture. A local recording save failure can prevent the stopwatch from starting. See [local recordings](local-recordings.md).
- Pending stopwatch commands are memory-only. The stopwatch is separate from authenticated Focus sessions and does not create Focus history.
- Source: [main window](../../apps/macos/TimerMac/Features/Stopwatch/TimerWindowView.swift), [controls](../../apps/macos/TimerMac/Features/Stopwatch/TimerControlsView.swift), [widget](../../apps/macos/TimerMac/Features/FloatingTimer/TimerSidebarView.swift), [connection settings](../../apps/macos/TimerMac/Features/Settings/SettingsDetailView.swift).
