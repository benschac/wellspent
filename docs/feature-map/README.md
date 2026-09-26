# Feature map

Source-grounded navigation map for agents writing or executing **macOS WellSpent** verification. Read the entry for the feature under test before choosing actions. This map describes the current checkout on September 26, 2026, including current uncommitted task-attribution work. It is not a record of live UI acceptance.

## How to use this map

1. Identify the macOS build, backend profile, account, and feature named by the verification step. Follow the linked entry's user path and visible labels. If a label or path differs in the running build, inspect the current UI and source; report map drift instead of guessing.
2. Establish the entry's prerequisites. Use a disposable local account or recording where a check creates data. Launch from [the macOS run guide](../../apps/macos/README.md#run-locally); follow [verification workflows](../verification.md#native-acceptance) for evidence boundaries. Do not switch to a hosted backend, reset a database, install a Codex adapter, or expose a token as an implicit setup step.
3. Drive the real user path, then record the action and the observable end state. A source read, test, build, API response, simulator, and physical device establish different things. Record blocked and unrun paths explicitly.
4. Check the relevant feature's empty, success, pending, error, and recovery states when the requested verification calls for them. For a web/macOS Focus comparison, use the same backend and account and compare the same durable session ID.

## Feature index

| Feature | macOS entry | Map |
| --- | --- | --- |
| Shared stopwatch, status, and save confirmation | Main **Timer** window or floating timer | [Stopwatch](macos-stopwatch.md) |
| Durable Focus sessions, notes, recaps, history | **Workspace → Open Focus** or `⌃⌥⌘F` | [Focus sessions](macos-focus.md) |
| Local foreground recording and timeline | Main Timer window → **Local Recordings** | [Local recordings](local-recordings.md) |
| Local tasks and evidence attribution | **Local Recordings** task controls and review timeline | [Task attribution](task-attribution.md) |
| Local Codex notes and metadata pairing | **Local Recordings → Connections** | [Recording connections](recording-connections.md) |
| Floating widget, Settings, and window entry points | Widget, app menu, or **Window options → Settings…** | [Window and settings controls](macos-controls.md) |

## Product boundaries

- The shared WebSocket stopwatch is a separate singleton from authenticated Focus history. The floating widget and main Timer window control the stopwatch; the Focus window controls durable account sessions.
- The recording timeline is local evidence. It does not prove focused human time or completed work. Task attribution in this working tree is not yet proof of a shipped build.
- R1 daily receipts, Ask Wellspent, encrypted vault sync, durable native offline Focus replay, and model/usage intake are planned work in [the current plan](../WELLSPENT_PLAN.md), not reachable macOS features in this map.

## Map maintenance

Update the affected feature entry when a route, label, prerequisite, state, or source owner changes. Keep this index in sync. For UI proof, observe the running app after the change; source inspection alone only establishes the intended path in this checkout.

Inspired by the [pstack feature-map pattern](https://github.com/cursor/plugins/blob/main/pstack/docs/guide/06-verify-and-ship.md) and its [worked example](https://github.com/poteto/verification-skill-example/blob/main/.cursor/skills/verify-atlas/references/features/README.md).
