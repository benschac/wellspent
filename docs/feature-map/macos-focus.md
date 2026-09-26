# macOS Focus sessions

## Sub-features

Native sign-in to the same Focus account as web; create, refresh, select, pause, resume, and finish sessions; add notes; edit/save/reload recap; inspect activity. This is a separate window from the shared stopwatch.

## How to get to it (user POV)

1. With WellSpent running, choose **Workspace → Open Focus**, use **Settings → Accounts → Open Focus**, choose **Open Focus** from the Timer window's **Window options**, or press `⌃⌥⌘F`.
2. If signed out, choose **Sign in** and enter the same email/password as web Focus. The account control and **Sign out** are in **Settings → Accounts**.
3. Enter an intention in **What do you want to focus on?** and press Return or choose **Start Focus**. Choose a row under **Recent sessions** for its detail. Use **Pause** / **Resume**, **Finish Session**, **Add Note**, **Save Recap**, or **Reload Saved Recap** there.
4. Choose **Recent sessions** to leave detail, **Refresh** at the bottom to load remote changes, or **Close Focus** to close only this window.

## Prerequisites

Use a build with the intended Focus API and Supabase Auth configuration. Browse with an existing account; create/finish/recap checks should use a disposable local account or session. A signed-out state is itself reachable without credentials.

## Observable check

- Confirm a session appears in **Recent sessions** after server confirmation. Select it and inspect its status, elapsed time, notes, recap, and activity. Refresh after a change made on web and compare the same session ID and saved recap revision when verifying convergence.
- An uncertain write should expose **Retry Save** and retain its original request. A conflicting recap must not silently replace the local draft. For lifecycle checks, use [native acceptance](../skills/run-native-acceptance/SKILL.md) and [macOS Focus auth](../macos-focus-auth.md).

## Gotchas

- There is no durable native offline queue or native capture-token control. Closing or changing account/backend can clear in-memory pending work after a warning.
- The global shortcut can conflict with another app. The app menu/Settings paths remain the fallback.
- The floating sidebar controls the shared stopwatch, not this Focus session.
- Source: [app menu](../../apps/macos/TimerMac/App/TimerMacApp.swift), [window](../../apps/macos/TimerMac/Features/Focus/FocusWindowView.swift), [detail](../../apps/macos/TimerMac/Features/Focus/FocusDetailView.swift), [account](../../apps/macos/TimerMac/Features/Settings/FocusAccountSettings.swift).
