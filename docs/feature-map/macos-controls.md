# macOS widget and settings

## Sub-features

Floating stopwatch widget visibility, drag/edge attachment, collapse, position lock, magnetic edges, and connection/account settings. Settings has **Accounts**, **Timer**, **Floating Sidebar**, and **Connection** categories.

## How to get to it (user POV)

1. Launch WellSpent. The main Timer window and floating timer appear. Click the widget face to start/pause; drag the face to reposition. Its gear opens **Settings**. Right-click the widget for **Open Timer Window**, **Settings…**, **Lock Position**, **Collapse to Ring**, **Reset Position**, **Hide Sidebar**, and **Quit Timer**.
2. From the main window, choose **Window options → Settings…**, or use `⌘,`. In **Timer**, use **Open Timer Window** or **Reset Timer**. In **Floating Sidebar**, use **Magnetic screen edges**, **Lock position**, **Show/Hide Widget**, and **Reset Position**.
3. In **Connection**, inspect the backend profile, sync status, active socket, pending/unconfirmed actions, API URL, optional stopwatch bearer token, **Reconnect**, and **Save**. **Accounts** contains Focus sign-in/out and **Open Focus**.

## Prerequisites

Run the macOS app on a desktop with a visible floating widget. Use the intended local backend profile for connection checks. Movement and visibility tests alter saved local preferences; record or restore the original placement when relevant.

## Observable check

- Moving the widget near an edge should attach it; farther away it should float. Locking should prevent movement. Hide/show and reset position should alter the visible widget accordingly. For persistence, relaunch the same build and inspect restored placement/visibility.
- **Connection** provides the exact endpoint, save status, and pending/unconfirmed action counts for shared timer checks. The main window's **Window options** shows the server revision when available. For reduced motion/transparency acceptance, use OS settings and inspect the live widget.

## Gotchas

- Connection settings can change the backend and clear in-memory pending Focus work after a warning. Do not change them during an unrelated check. The stopwatch token is separate from Focus account credentials.
- The menu bar timer icon reopens the main window; it is not a full status menu. Closing a window does not stop shared services.
- Source: [widget](../../apps/macos/TimerMac/Features/FloatingTimer/TimerSidebarView.swift), [settings categories](../../apps/macos/TimerMac/Features/Settings/SettingsCategory.swift), [settings detail](../../apps/macos/TimerMac/Features/Settings/SettingsDetailView.swift), [window options](../../apps/macos/TimerMac/Features/Stopwatch/TimerWindowActionsView.swift), [status item](../../apps/macos/TimerMac/App/TimerStatusItemController.swift).
