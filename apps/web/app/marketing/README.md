# Good Hours marketing preview

Local route: `/marketing`. The working public name is **Good Hours**. This page implements the selected dark concept with the focus control extending from the right edge.

## Waitlist configuration

Set `GOOD_HOURS_WAITLIST_URL` to the existing HTTPS signup destination in the web app's server environment, then rebuild. This statically rendered route reads the setting during the build. Every waitlist CTA uses that destination. Without a valid HTTPS URL, the page explicitly shows that signups are opening soon; it does not collect or claim to save an email.

## Interactive preview

The timer starts, pauses, and resets. Dragging the glass control deforms its connection to the edge and it settles back on release. The journal has keyboard-accessible Session, Notes, and Recap tabs. Notes are held only in component state and disappear on reload. The sample journal is demonstration content.

Three.js is lazy-loaded. Its canvas renders on interaction, resizing, and settling, and stops when idle or offscreen. Pointer tilt and dragging respect reduced motion. A DOM control remains usable without WebGL. Geometry, materials, environment textures, observers, and event listeners are disposed on unmount.

## Sources and licensing

- Original Three.js focus-control geometry: `focus-scene.ts`.
- ThreeUI studio-lighting technique adapted from `src/shaders/skeuomorphic-toggle/glassToggleScene.ts` at commit `68802d5428071ada5c20db8094b1649e6bb770ed`: https://github.com/MengTo/threeui. MIT attribution retained in `threeui/LICENSE` and the helper.
- Applied MengTo Three.js, landing-page, and animation guidance from https://github.com/MengTo/Skills at commit `321c769739b823de5eb94eb3a52aa1974fe783a2`.
- Instrument Serif is self-hosted; its OFL license is in `public/marketing/fonts/LICENSE.md`.
- `dark-atmosphere.webp` is a generated background asset. The focus device itself is live Three.js geometry.

Added dependencies: `three`, `@types/three`, and `@radix-ui/react-icons`.

## Validation

From the repository root:

```sh
bun run --cwd apps/web typecheck
bun run --cwd apps/web lint
bun run --cwd apps/web build
```

Visual and interaction evidence is recorded in `apps/web/design-qa.md`. The page has not been published.
