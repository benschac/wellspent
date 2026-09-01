# Timer for macOS

A native SwiftUI desktop and menu-bar projection of the repository's
authoritative timer state. The existing Tauri desktop app remains available in
`apps/desktop`.

## Run locally

1. Start the API with `bun run dev --filter=@repo/api` from the repository root.
2. Open `TimerMac.xcodeproj` and run the `TimerMac` scheme. The app opens a
   regular desktop window, appears in the Dock, and keeps its menu-bar controls.
   You can also run `.derivedData/Build/Products/Debug/TimerMac.app` after a
   package build.
3. Open Settings from the desktop window or menu-bar popover to change the API
   URL. The default is `http://localhost:3001`.

An optional bearer token can be saved in Settings. It is stored in the macOS
Keychain and attached to the WebSocket upgrade request. The current shared timer
gateway does not reject unauthenticated clients, so adding a token is
forward-compatible rather than an authorization boundary today.

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
