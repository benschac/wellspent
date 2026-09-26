# macOS task attribution

## Sub-features

Create reusable local tasks, select or switch the task while recording, inspect selection history, assign an observation to a task or **Unassigned**, and undo a correction without deleting original evidence. These controls are present in the current uncommitted macOS working tree; a built or distributed app may not contain them.

## How to get to it (user POV)

1. Open the main Timer window's **Local Recordings** area. Choose **New task…**, enter **Task title**, then **Create task**.
2. While recording, open **Current recording task** and choose the task or **Unassigned**. Select a saved recording to read task selections in its review pane.
3. In the selected recording's **Timeline**, find an observation. Open its **Assign task** menu to choose a task or **Unassigned**. For foreground application observations, **Use recording selections** returns to the recorded selection spans. Use **Undo this assignment** in correction history to reverse a correction.

## Prerequisites

Use a macOS build that includes the current task controls, a writable local recording store, and a disposable active recording or saved recording with an observation. The task menu is only actionable in eligible recording states.

## Observable check

- The task should remain available in **Current recording task** across recordings. A task switch should create a time-bounded selection entry; a later correction should change the interpreted assignment while preserving the original event and operation history.
- After closing and reopening a disposable recording, check the task, selection, correction, and undo states. Record the app build and working-tree state. The [C4 evidence](../design/2026-09-26-c4-task-attribution.md) separates isolated native renders from full keyboard/VoiceOver acceptance.

## Gotchas

- New or resumed intervals begin **Unassigned**. Agent activity remains unassigned until explicitly corrected. Do not infer a task from the active app or repository.
- Task controls can be disabled when there is no eligible recording state or a save/reload is pending. Error controls include **Retry task save / load** and **Clear retry and reload**.
- Source: [task controls](../../apps/macos/TimerMac/Features/Recording/RecordingTaskControlsView.swift), [attribution menu/history](../../apps/macos/TimerMac/Features/Recording/RecordingAttributionView.swift), [selection history](../../apps/macos/TimerMac/Features/Recording/RecordingTaskHistoryView.swift), [model](../../apps/macos/TimerMac/Features/Recording/RecordingModel.swift).
