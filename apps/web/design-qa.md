# Good Hours design QA

Final result: **passed for local design review**. The waitlist destination remains an external launch dependency, so this is not a claim of launch readiness.

## Reference and capture

Authoritative source: the dark generated concept with “Give your best hours to what matters” and the glass timer attached to the right edge. The earlier ivory direction was superseded by the user's correction.

Source image: `/Users/benjaminschachter/.codex/generated_images/01a0741b-d196-7243-8829-5446555c6721/exec-1019b295-09c7-444b-818c-11ff22f7ae2c.png` (1374 × 1145).

Live page: http://localhost:3100/marketing

Desktop screenshots were captured at 1374 × 1145 and mobile at 390 × 844 through Chrome CUA. A combined comparison placed the source and a live 1374 × 1145 iframe beside each other at equal 50% scale. The final comparison was visually inspected after the font, layout, and glass changes. CUA returned inline screenshots in this conversation; it did not expose a filesystem screenshot path. The temporary comparison HTML is retained outside the app at `/private/tmp/good-hours-qa-comparison.html` and is not shipped.

## Visual assessment

- Layout: dark canvas, left editorial message, ivory pill CTA, right-edge glass instrument, floating session recap, and two-column day recap match the chosen composition.
- Typography: self-hosted Instrument Serif matches the narrow editorial character. Adjusted headline spacing and line breaks after the first comparison.
- Color and surfaces: near-black background, muted cool illumination, cream highlights, smoked glass, thin borders, and subdued copy replace the ivory direction throughout.
- Product detail: the instrument is rendered in Three.js with a real progress ring and a flexible connection to the right spine. The scene was resized and repositioned after comparing the reference.
- Responsive layout: the message remains first; the device and recap stack below it on mobile. No horizontal overflow at 390 px. The recap is readable and navigation/CTAs remain accessible.
- Continuation: the approach, audience, FAQ, and closing waitlist sections extend the same typography and visual language below the supplied reference.

Remaining visual difference (P3): live glass reflections and the device face differ from the generated photographic source. The reference's small fictional journal details were adapted into an interactive two-session demonstration, and the paused initial control uses Play. No unresolved P0/P1/P2 visual defects were identified in the checked viewports.

## Behavior and technical checks

- Timer: started from 32:18, advanced to 32:24, and paused; control labels updated.
- Drag: moved the device, confirmed the drag marker, and verified release settled both CSS offsets to 0 px. The canvas reported idle afterward.
- Journal: edited a note and confirmed “Saved in this preview”; opened recap details. Tab keyboard handling is implemented for arrows, Home, and End.
- Waitlist: without configuration, the native dialog truthfully reports that signups are opening soon; Escape closes it.
- Rendering: WebGL initialization succeeded. The canvas stopped rendering when idle and offscreen. Reduced-motion branches and cleanup were inspected in source; no live reduced-motion emulation or physical-device testing was performed.
- Browser logs: no application-origin errors observed in the final desktop check; Chrome's Grammarly extension emitted its own warning/error messages.
- Mobile: document scroll width and viewport width both measured 390 px. Scrolling to the footer left no unrevealed content in the viewport.
- TypeScript, ESLint, and Next production build passed. The build emitted only an experimental environment proxy warning. `/marketing` was included in static route output.

## Scope and remaining launch dependency

Implementation is in `apps/web/app/marketing` with assets in `apps/web/public/marketing`, dependencies in `apps/web/package.json` and `bun.lock`. Existing app routes and unrelated dirty work were preserved. Set the real HTTPS `GOOD_HOURS_WAITLIST_URL` and rebuild before using the page to collect signups. No signup backend or public deployment was created.
