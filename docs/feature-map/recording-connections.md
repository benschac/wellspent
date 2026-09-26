# macOS recording connections

## Sub-features

An **AI Harness** connection for explicitly submitted `log_work` notes, and a separate **Local Codex activity** pairing for selected hook metadata. Both attach to active local recording intervals; neither starts recording.

## How to get to it (user POV)

1. Open the main Timer window's **Local Recordings** area and choose **Connections**. The **Recording connections** sheet contains **AI Harness** and expandable **Local Codex activity**.
2. Under **AI Harness**, choose **Connect Codex…** and approve **Connect Codex**. Start a new Codex session so it discovers `wellspent-local.log_work`. Start or resume a local recording before submitting a note. Use **Disconnect** to revoke that connection.
3. For metadata pairing, expand **Local Codex activity**, enter **Helper sender ID**, **Codex thread ID**, and **Port**, then choose **Create pairing**. Use the private bundle only with the local helper's setup input. **Revoke pairing** ends admission for that binding.

## Prerequisites

For the development **AI Harness** flow, run the local harness supervisor and have Node 22+ and Codex CLI installed. A newly started Codex session must discover the connection. For metadata pairing, have the local helper coordinates and an active recording interval. Both setup flows change private local configuration; use an explicitly authorized disposable setup for a live check.

## Observable check

- Check the visible `harness-status` and `local-codex-status` values. An explicit `log_work` call from the newly started Codex session should appear once as a local timeline note in the active interval; a paused or finished interval should reject it.
- A paired metadata report appears only after the interval boundary that admits it. Inspect its allowlisted ID/tool/result fields under timeline **Details**. Record connection, interval, thread, and event IDs without copying credentials or private note content into evidence.

## Gotchas

- **Connect Codex…** modifies the local Codex configuration after an explicit UI confirmation. It is an installation step, not a routine read-only verification action. The development flow requires the local harness process, Node, and Codex CLI; see [macOS setup](../../apps/macos/README.md#local-codex-ai-harness).
- A connection does not install metadata hooks, and a pairing does not discover an MCP tool in an already-running Codex session. Metadata collection and prose notes have distinct consent paths.
- Pausing/resuming requires a new pairing for the new interval. Automatic metadata and model/usage intake have different coverage; do not treat a note as token usage proof.
- Source: [sheet](../../apps/macos/TimerMac/Features/Recording/RecordingWindowView.swift), [AI Harness UI](../../apps/macos/TimerMac/Features/Recording/LocalHarnessView.swift), [pairing UI](../../apps/macos/TimerMac/Features/Recording/LocalCodexPairingView.swift), [local integration guide](../../integrations/codex/README.md).
