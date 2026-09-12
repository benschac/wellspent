# Timer for macOS

A native SwiftUI/AppKit floating sidebar and menu-bar projection of the repository's
authoritative timer state. The existing Tauri desktop app remains available in
`apps/desktop`.

## Run locally

1. Start the API with `bun run dev --filter=@repo/api` from the repository root.
2. Open `TimerMac.xcodeproj` and run the `TimerMac` scheme. The app opens a
   frosted timer sidebar on the right edge of the primary display and keeps its
   menu-bar controls. It runs without a Dock icon or an initial desktop window.
   You can also run `.derivedData/Build/Products/Debug/TimerMac.app` after a
   package build.
3. Open Settings from the sidebar gear or menu-bar menu to change the API
   URL. The default is `http://localhost:3001`.

Focus authentication is separate from the shared stopwatch. Existing optional
stopwatch credentials remain in their original Keychain store; Focus account
changes never reconnect or clear the stopwatch.

## Focus sessions

Press **Control–Option–Command–F (⌃⌥⌘F)** while Timer is running, or choose
**Open Focus** in the menu bar or Settings. This opens a separate native window
for the authenticated `/api/focus/sessions` API:

- Browse the latest 100 sessions; start, pause, resume, and finish sessions.
- Add notes, edit recaps, and read generated recaps and captured activity.
- Choose **Sign in** and enter your existing Focus email and password. Settings shows your account
  and **Sign out**. Sessions persist in Keychain and refresh automatically.
  See [provider setup and acceptance](../../docs/macos-focus-auth.md).
- Refresh to see updates from other devices. Reopening Focus also refreshes it.
  Local ticking uses a monotonic clock between server snapshots.

Focus changes appear after the server confirms them. An uncertain save stays
available as **Retry Save**, using the exact original request and command ID.
Recap drafts retain their original revision so a remote edit cannot be silently
overwritten. Pending requests and drafts are memory-only: quitting or changing
accounts or the API URL clears them after a warning. There is no durable offline queue or push sync in
this native interface yet. Capture-token creation and revocation remain in the
web interface; captured activity is readable here.

The global shortcut uses the system hotkey API, with no extra dependency or
Accessibility permission. If registration fails, Settings and the Focus window
show the error and the menu remains available. Custom shortcuts in other apps
can still conflict. The floating sidebar continues to control the separate shared
stopwatch; it does not control these focus sessions.

Validation: `bun run --cwd apps/macos test` builds the app and runs the native
suite, including Focus HTTP contract, exact-request retry, account-switch, and
recap-revision tests. Live authenticated API use and physical keyboard activation
are separate acceptance checks.

## Floating controls

- Click the compact timer to start/resume or pause. Drag the timer face to move
  the widget; moving at least 4 points counts as a drag and cannot also toggle
  the timer. The gear remains a separate settings button. Hover opens nothing.
- On supported trackpads, one subtle alignment haptic accompanies the liquid
  connection breaking. It is synchronized to drawing and fires once per pickup,
  so moving back and forth near the separation point does not chatter.
- Drop within 78 points of a usable screen edge for a short magnetic settling
  animation. Farther away, the grabbed point stays where it was released. Top/bottom
  attachments and detached widgets use a horizontal layout; left/right
  attachments use a vertical layout. Snapping provides alignment feedback on
  supported trackpads. Reduce Motion disables the liquid deformation and animated settling.
- The timer counts up from zero using the shared realtime elapsed state. Pause
  preserves elapsed time; Resume continues it without a duration limit. Reset
  clears elapsed time and preserves whether the timer is running, matching the
  mobile and desktop clients. The ring sweeps forward once per minute using an
  animation timeline targeting 60 frames per second. It samples the same monotonic
  timer clock without publishing per-frame model updates, stops rendering frames
  while paused, and uses a one-second cadence with Reduce Motion enabled.
- Settings contains reset, an explicit Open Timer Window button,
  magnetic-edge and position-lock toggles, and connection configuration.
  The menu bar uses a compact native menu instead of another timer popover.
- Placement and visibility are remembered across launches. Position is stored
  relative to the display's usable area so resolution changes remain safe.
  A disconnected preferred display falls back to the primary display until it
  reconnects. Reset Position provides a recovery action in Settings.
- The panel joins all Spaces and supports full-screen app Spaces. It follows the
  display's usable frame as the Dock or display layout changes. Transparent
  corners pass mouse clicks through; no new system permission is required.

The floating presentation is implemented in `TimerSidebarController` and the
`TimerSidebar*` views. `TimerDragView` owns native mouse events in screen coordinates;
`TimerSidebarLayout` owns snapping and placement. `TimerMotionClock` drives geometry
in sync with the display and a critically damped spring on release. The shape and
content morph together while pulling away. `TimerLiquidShape` supplies one continuous
outline to the AppKit frosted backdrop, tint, and rim. The whole shoulder broadens
into a short neck, separating at a 28-point gap and retracting over the next 18
points. The wall remnant starts at the original attachment size and stays aligned
to that contact during perpendicular pulls. Curves fit the body and wall footprint
without rectangular clipping. This is a surface-tension-inspired presentation
model, not a physical fluid simulation. Drag progress follows the
hand directly; only release uses easing. Reduce Transparency uses an opaque
fallback, and Reduce Motion disables deformation. Controls stay in a separate,
undistorted layer. Window shadows are disabled during morphing. Tests verify
native frost coverage through the neck, separation, and bounds on all four edges,
and export rendered stages. The grabbed ring or label stays under
the pointer, including when window bounds expand for the neck. Picking up a
settling widget immediately stops the spring. `TimerAppDelegate` owns the single shared
`TimerModel`; AppKit owns panel and auxiliary-window lifetimes. This does not
change the realtime protocol or timer projection.

## Monorepo commands

```sh
bunx turbo run build --filter=@repo/macos
bunx turbo run lint --filter=@repo/macos
bunx turbo run test --filter=@repo/macos
```

Swift formatting uses the `swift-format` executable bundled with the selected
Xcode toolchain, so no separate Homebrew or Swift package dependency is needed:

```sh
bun run --cwd apps/macos format
```

Xcode owns compilation, testing, signing, archiving, and packaging. Turbo does
not cache DerivedData or signed products for this package.
