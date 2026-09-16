# Local recordings in Settings — September 16, 2026

## Requested outcome

Make recording history discoverable in Settings, give its timeline the main viewing area, and show the newest action first. This is a bounded C4 UI follow-up before append-only annotations/corrections.

## Changes

- Local Recordings is a Settings sidebar destination. Existing menu, timer and workspace recording shortcuts select it in the shared Settings window.
- The Settings window opens at 1120 × 760. Recording history and the independently scrolling timeline fill the available height beneath compact capture controls.
- Connections opens a separate sheet containing the existing AI Harness and Codex pairing controls. Sample actions remain available from a compact menu.
- History rows include start date/time to distinguish otherwise identical recording names.
- Timeline intervals appear newest first; events use descending evidence time with reverse save order for ties. Coverage gaps stay between their original intervals. Stored events and intake semantics are unchanged.

## Verification

- `bun run --cwd apps/macos lint` and `git diff --check`: passed.
- `bun run --cwd apps/macos test`: passed, 242 tests / 344 executions, zero failures/skips. Debug, `CODE_SIGNING_ALLOWED=NO`, macOS 26.3 / 25D125, arm64. Result: `apps/macos/.derivedData/Logs/Test/Test-TimerMac-2026.09.16_09-45-29--0400.xcresult`.
- A focused `RecordingWindowTests` rerun passed after changing its screenshot capture to AppKit's hosted view, because `ImageRenderer` cannot render native lists/menus. Result: `Test-TimerMac-2026.09.16_09-47-51--0400.xcresult` in the same directory.
- Inspected the hosted synthetic recording screenshot: the timeline occupies the primary detail area and shows descending event times. AppKit bitmap capture did not resolve the frosted Settings sidebar/compositor, so it is partial visual evidence, not full-window visual acceptance.
- Tests cover Settings-window reuse and selection, descending interval/event order, delayed source/hook times, equal-time tie ordering, and preserved gaps/evidence.
- Initial sandboxed Xcode invocation failed on normal host cache access; the authorized host-cache rerun above passed.

Keyboard, VoiceOver, connection-sheet interaction and full visual acceptance in the user's signed app remain unverified. The user's running app was not replaced or relaunched.
