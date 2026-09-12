# Good Hours marketing preview

Local route: `/marketing`. The working public name is **Good Hours**. This page implements the selected dark concept with the focus control extending from the right edge.

## Waitlist configuration

Set `GOOD_HOURS_WAITLIST_URL` to the existing HTTPS signup destination in the web app's server environment, then rebuild. This statically rendered route reads the setting during the build. Every waitlist CTA uses that destination. Without a valid HTTPS URL, the page explicitly shows that signups are opening soon; it does not collect or claim to save an email.

## Interactive preview

The timer starts, pauses, and resets. Dragging the glass control deforms its connection to the edge and it settles back on release. The journal has keyboard-accessible Session, Notes, and Recap tabs. Notes are held only in component state and disappear on reload. The sample journal is demonstration content.

React Three Fiber and Three.js are lazy-loaded in a client-only canvas. The scene uses on-demand rendering for interaction, resizing, and settling, and suspends its frame loop while offscreen or the document is hidden. Pointer tilt and dragging respect reduced motion. A DOM control remains usable while loading, without WebGL, or after context loss. Geometry, materials, environment textures, observers, and event listeners are disposed on unmount.

`focus-scene.tsx` declares the meshes, materials, lights, and studio environment. `focus-geometry.ts` preserves the original rail and deforming connector geometry. `focus-interaction.ts` bridges the existing DOM drag events to scene refs without React state updates on each animation frame. `glass-focus.tsx` owns lazy loading and the error boundary. The timer, drag settling, and accessible controls remain in `marketing-page.tsx`.

## Sources and licensing

- Original Three.js focus-control geometry: `focus-geometry.ts`.
- ThreeUI studio-lighting technique adapted from `src/shaders/skeuomorphic-toggle/glassToggleScene.ts` at commit `68802d5428071ada5c20db8094b1649e6bb770ed`: https://github.com/MengTo/threeui. MIT attribution retained in `threeui/LICENSE` and the helper.
- Applied MengTo Three.js, landing-page, and animation guidance from https://github.com/MengTo/Skills at commit `321c769739b823de5eb94eb3a52aa1974fe783a2`.
- Instrument Serif is self-hosted; its OFL license is in `public/marketing/fonts/LICENSE.md`.
- `dark-atmosphere.webp` is a generated background asset. The focus device itself is live Three.js geometry.

Added dependencies: `three`, `@types/three`, `@radix-ui/react-icons`, and `@react-three/fiber` (9.7.0, compatible with React 19).

## Validation

From the repository root:

```sh
bun run --cwd apps/web typecheck
bun run --cwd apps/web lint
bun run --cwd apps/web build
```

Visual and interaction evidence is recorded in `apps/web/design-qa.md`. The page has not been published.

### R3F migration verification (2026-09-08)

- Web typecheck, focused Biome checks, and the Next production build passed; `/marketing` remains statically prerendered. The build used a separate output directory to preserve the running development server.
- Chrome desktop screenshots before and after migration were visually compared. The glass, lighting, ring, connector, and DOM control alignment were preserved.
- The demo started, advanced from 32:18 to 32:42, and paused. Dragging set the drag marker, release settled both CSS offsets to zero, and the canvas subsequently reported idle. Scrolling the hero offscreen also left it idle.
- At 390 × 844, the scene resized and the document width matched the viewport at 390 px, with no horizontal overflow.
- Reduced-motion switching, WebGL-unavailable/context-loss fallback, and resource cleanup were inspected in source, but were not fault-injected or profiled live. No physical-device acceptance or deployment was performed.
- R3F 9.7.0 internally constructs `THREE.Clock`, which Three.js 0.185.1 warns is deprecated. This upstream warning remains visible; application code does not construct a clock. The build also emits the existing experimental environment-proxy warning.
