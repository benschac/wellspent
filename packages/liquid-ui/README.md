# Liquid UI

One Swift source tree, consumed by the native macOS app and an Expo iOS view.

- `Sources/LiquidUI`: liquid contour, edge shapes, geometry, tint/rim rendering, and settling math. No Expo or AppKit dependency.
- `Package.swift`: builds those sources as `LiquidUI` for the macOS app.
- `ExpoLiquidUI.podspec`: compiles the **same files** together with `ios/` as the Expo module. SwiftPM is not invoked by CocoaPods.
- `ios/`: Expo props/events, touch gestures, and the iOS material backdrop.
- `src/`: the React wrapper, which owns its Expo UI `Host`, plus an Android/web fallback.

The package was created with Expo's official `create-expo-module` scaffold, then moved into this Bun workspace. Expo discovers it through the mobile app's `@repo/liquid-ui` workspace dependency. There is no copy step or custom symlink script.

## Try it

Rebuild the iOS development client after installing dependencies and running `pod install` in `apps/mobile/ios`. Open **Liquid animation** from the app drawer. Pull the handle away from an edge, release it, and drag it back. The edge buttons and Reattach button reset its position. The native handle also exposes VoiceOver Detach/Reattach actions.

```tsx
import { LiquidView } from "@repo/liquid-ui";

<LiquidView
  style={{ flex: 1 }}
  edge="right"
  onAttachmentChange={({ attached, edge }) => {
    console.log({ attached, edge });
  }}
/>
```

Give the view bounded dimensions. `edge` accepts `left`, `right`, `top`, or `bottom`. Changing `resetKey` reattaches the handle. Drag and animation frames stay in Swift; events report completed changes of attachment state.

This first integration demonstrates the shared contour with a draggable handle. It does not port the macOS timer controls, floating desktop window, or screen-wide window behavior. The iOS surface attaches within its view. Android and web show a fallback; they do not load the Swift module.

## Ownership and coordinates

The Mac host retains its `NSVisualEffectView` desktop blur, native display link, window placement, and mouse handling. `TimerLiquidSurface` accepts a backdrop closure so both hosts use exactly the same path for blur, tint, and rim.

Paths and body frames use SwiftUI coordinates, with Y increasing downward. The existing `TimerSidebarGeometry.frame(holding:offset:byRing:)` and `detachment(edge:translation:)` APIs explicitly retain AppKit screen-coordinate conventions (Y increasing upward) for macOS compatibility. The iOS adapter computes its layout in local view coordinates.

## Verify

```sh
bun run --cwd packages/liquid-ui typecheck
bun run --cwd apps/mobile typecheck
bun run --cwd apps/macos lint
bun run --cwd apps/macos test
```

The existing macOS liquid, mask, layout, and motion tests now exercise the shared Swift package. Native changes require an iOS rebuild; Metro Fast Refresh only updates the React wrapper.
