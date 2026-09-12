# Backend launch profiles

Launch a development app against local services or the production API without rewriting any env files. `prod-api` means **development app, real production data**, not a release build. No runtime dropdown is included.

From the repository root:

| App | Local services | Production API |
| --- | --- | --- |
| Expo / Metro | `bun run --cwd apps/mobile dev:local` | `bun run --cwd apps/mobile dev:prod-api` |
| Next.js web | `bun run --cwd apps/web dev:local` | `bun run --cwd apps/web dev:prod-api` |
| Native macOS | `bun run --cwd apps/macos dev:local` | `bun run --cwd apps/macos dev:prod-api` |

`dev` remains the local default for web and Expo. macOS has explicit launch commands only, so the root Turbo `dev` command does not unexpectedly open a native window. These commands start clients, not the NestJS backend or Supabase, and never apply migrations or modify deployment settings.

## Profile configuration

The shared Node launcher (`scripts/backend-profile.mjs`) reads local settings from the selected app's `.env`, `.env.development`, `.env.local`, and `.env.development.local` (later files take precedence). Production-profile settings come **only** from that app's `.env.prod-api.local`. Shell API/auth overrides cannot leak a previous profile into the next run.

- Local API defaults to `http://localhost:3001`. Existing local API URL settings are respected; use `LOCAL_API_URL=http://192.168.x.x:3001` in the app's `.env.local` for an explicit LAN override. Remote URLs are rejected by the local profile.
- Production API is fixed to `https://api.wellspent.day`.
- The web launch sets both server `API_URL` and browser `NEXT_PUBLIC_API_URL` together. API and Supabase auth must both be local or both hosted.
- Other selected app env values are preserved. Google OAuth secrets and encryption keys remain on the backend; never place them in browser/mobile public env variables.
- Local backend Google callbacks stay local. The deployed backend owns its production callbacks. Client launch profiles do not change either backend's env file.

### Production web auth setup (once)

Create `apps/web/.env.prod-api.local` using `apps/web/.env.prod-api.example` as the template. Fill in the hosted Supabase URL and publishable key for the **same project trusted by the production NestJS backend**. Do not use a service-role/secret key. The launcher fails with an actionable error if these values are missing; it never substitutes local auth.

## Separation and warnings

Web uses **localhost:3000 for local** and **localhost:3002 for production API**. Browser localStorage, Supabase sessions, query clients, and pending focus commands remain separate by origin. Existing local data at localhost:3000 is left untouched. Don't manually run the production profile on port 3000 or route both through the same origin. The ports are fixed in the launcher. Next.js outputs are separate (`.next-local` / `.next-prod-api`) so both development servers can run independently. Production API CORS must allow `http://localhost:3002` for this developer workflow.

Expo uses **Metro 8081 for local** and **8083 for production API**. Open the selected server in your existing development client and fully reload. A URL-only change does not require a native rebuild. A phone must be able to reach your Mac/LAN API; the app's existing localhost-to-Metro-host helper remains in place. Stop old Metro instances when no longer needed. A native widget/Live Activity may still reference its prior backend until the app updates it; end existing Live Activities before switching, and confirm the in-app environment banner before using native controls.

For native install-and-launch:

```sh
bun run --cwd apps/mobile ios:local -- --device
bun run --cwd apps/mobile ios:prod-api -- --device
bun run --cwd apps/mobile android:local
bun run --cwd apps/mobile android:prod-api
```

macOS builds the existing Debug target and launches its executable with a process-scoped API URL. **Quit the running TimerMac app before switching**; the launcher will refuse to reuse an existing instance. The profile does not overwrite the server URL saved by Finder/Xcode launches, and locks the URL field for that run. Profile launches use endpoint-scoped Keychain accounts instead of reusing the legacy saved token. Enter a token for that endpoint if the deployed gateway requires one. Menu/window/settings display the active target, and production profile launches add `PROD` to the menu-bar timer. In-flight in-memory actions do not transfer between app processes.

Web and Expo show developer-only environment banners. Release builds are unchanged; these scripts are not an EAS Build/Update or web production-deployment workflow. Public client values are embedded in their bundles, so production build settings still need to be configured on the hosting/build service.

## Verification without launching an app

```sh
bun run test:profiles
bun run --cwd apps/mobile dev:prod-api --dry-run
bun run --cwd apps/web dev:local --dry-run
bun run --cwd apps/macos dev:prod-api --dry-run
```

Dry runs print only the target origin/profile/port, not credentials. No app is launched and no API requests are made. Web production dry runs still require the production auth configuration.
