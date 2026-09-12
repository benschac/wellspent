# macOS Focus authentication

Focus signs in with the same Supabase **email and password** as the web app.
Choose **Sign in**, enter those credentials in the native sheet, and submit.
The app loads that Supabase user's Focus sessions. Settings shows the account
email and **Sign out**. No Google provider, browser callback, OAuth client,
redirect allow list, or additional dependency is required.

## Backend configuration

The app and API must use the same Supabase project. Each Xcode build runs
`scripts/macos-auth-configuration.mjs` and writes a whitelisted
`Contents/Resources/FocusAuthConfiguration.json` into that specific app bundle.
It contains only the API origin, Supabase origin, and publishable/anon key.
It is regenerated on every build, before signing; no generated key file belongs
in source control. Node must be installed (the build phase includes the standard
Homebrew locations). No new dependencies are required.

| Workflow | Configuration source |
| --- | --- |
| Xcode Run / ordinary Debug build | `WELLSPENT_BACKEND_PROFILE` build setting, default `local`; public values are read from the matching web environment and bundled by the target build phase. |
| `bun run --cwd apps/macos dev:local` | Matching local web environment; the launcher supplies the same profile to both build and process. |
| `bun run --cwd apps/macos dev:prod-api` | Only `apps/web/.env.prod-api.local`; the launcher selects `prod-api` for both build and process. |
| Finder / Dock / normal app relaunch | The profile and public auth values in that exact app bundle; Keychain restores the session for that API/Supabase pair. No shell environment is needed. |

Local web environment precedence is `.env`, `.env.development`, `.env.local`,
then `.env.development.local` under `apps/web`. In this checkout,
`apps/web/.env.local` provides `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the API is `http://localhost:3001` and
Supabase is `http://127.0.0.1:54421`. The build checks the local Supabase origin
against `SUPABASE_URL` from `apps/api/.env` (with `.env.local` overrides).
Missing configuration, a mismatched API provider, or an invalid public key fails
the build. The public-key check rejects secret, service-role, and authenticated
bearer credentials. Supabase's settings endpoint confirmed email auth is enabled.

For production, provide the **matching hosted API project's**
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in
`apps/web/.env.prod-api.local` (template: `.env.prod-api.example`). That file is
absent in this checkout; production auth is therefore unavailable and fails
closed. Local values never fill this gap. No hosted configuration was changed.
For an Xcode production build, set the user-defined **build setting**
`WELLSPENT_BACKEND_PROFILE=prod-api`, or pass that setting to `xcodebuild`.
A Run-scheme environment variable alone does not select the build profile.

An explicit process `WELLSPENT_API_URL` overrides the bundled API; an explicit
`WELLSPENT_SUPABASE_URL` / `WELLSPENT_SUPABASE_PUBLISHABLE_KEY` pair overrides
the bundled provider. Supply all three together for a deliberate launch override.
An incomplete or invalid explicit provider fails closed. For relaunch consistency,
prefer building the intended profile instead of adding temporary Run overrides.

The bundled profile owns API selection just like the package launch profile and
uses the existing profile-scoped stopwatch credentials. It never overwrites the
saved unprofiled API preference. Without a launch or bundled profile, Settings
uses that saved API choice, then the legacy local default. Auth resolution uses
explicit launch values, then a bundle whose API origin matches exactly, then
validated public configuration saved for that API origin. A trailing slash is
canonicalized before preference lookup. Another API, even in the same environment,
cannot consume a different API's bundled provider.

Session credentials stay in a device-only Keychain item scoped by both API and
Supabase origins, in a separate service from stopwatch credentials. Quit before
switching profiles. Multiple DerivedData copies are distinct artifacts: relaunch
the path just built, not an arbitrary app selected by its shared bundle identifier.

## Credentials and lifecycle

The password is sent only in the body of Supabase's supported
`POST /auth/v1/token?grant_type=password` request. It is cleared from the form on
submission/cancellation and is never written to Keychain, preferences, logs, or
URLs. Access/refresh tokens and expiry are stored together in Keychain. Credential
requests use an ephemeral URLSession that refuses redirects.

Refresh is single-flight, runs before expiry and requests, and rechecks on
activation/wake. Network failures keep the refresh credential and allow retries.
Rejected refresh/API 401 asks for sign-in again while keeping work scoped to the
same account. A temporarily failed Keychain write retains the rotated refresh
credential in memory for a storage retry.

Incorrect credentials, unconfirmed email, rate limits and network failures have
specific form messages. Cancel dismisses the form and invalidates the in-flight
attempt so a late response cannot sign the user in.

Same-user refresh and reauthentication preserve drafts, recap base revisions,
and uncertain requests. Another account/backend clears them and rejects old
in-flight responses. The UI warns before discarding unsaved work or uncertain
saves. An uncertain request may already have committed; retry it in the original
account to determine the outcome. No request is replayed under another account.
Drafts and pending requests remain memory-only.

Sign-out first removes Keychain credentials, then revokes this device's Supabase
session (`scope=local`). Offline sign-out still removes local data and reports
unconfirmed server revocation. Keychain deletion failures do not report successful
sign-out. Focus account operations do not replace the shared stopwatch's token,
connection, timer state or queue.

[Supabase password sign-in](https://supabase.com/docs/reference/swift/auth-signinwithpassword)
and the [Supabase REST contract](https://github.com/supabase/auth/blob/master/openapi.yaml)
define the provider flow. Account creation, password reset, CAPTCHA and MFA setup
are outside this native sign-in form.

## Verification

```sh
bun run test:profiles
bun run --cwd apps/macos lint
bun run --cwd apps/macos test
bun run --cwd apps/macos build
```

The native suite exercises password request encoding, incorrect-password retry,
email confirmation and rate limits, password non-persistence, cancellation,
profile isolation, Keychain restoration, refresh rotation/single-flight behavior,
network/storage/revocation failures, account switching and stale responses.
These tests use synthetic credentials and isolated storage.

Refresh after real token expiry, a second real account, and live uncertain-save
recovery were not forced during this configuration acceptance. Those boundaries
remain covered by the automated lifecycle tests; this run does not claim new
live evidence for them. No production configuration was changed.

Configuration verification on September 8 identified the failing Xcode app at
`~/Library/Developer/Xcode/DerivedData/TimerMac-bdqwvbcnppjxyhdqfeerlizlrvvs/Build/Products/Debug/TimerMac.app`.
The running process had no `WELLSPENT_*` launch variables, and the shared scheme
had no auth environment or generated public resource. The live Settings screen
showed the configuration error with API `http://localhost:3001`, while the
stopwatch was connected at revision 49 with zero queued/unconfirmed actions.
The saved public provider matched the web/API values in the unsigned app
preferences (`~/Library/Preferences`). The Xcode sandbox had a separate domain
at `~/Library/Containers/com.benjaminschachter.timer.macos/Data/Library/Preferences`;
it contained the local API choice but no `focus-auth-provider:` settings. The
Xcode scheme supplied no environment fallback. The new build resource supplies
the public provider on first launch in either sandbox, without relying on a
previous package-script launch to populate preferences. Focus was signed out with an empty intention before
replacement.

### Executed acceptance (September 8, macOS 26.3)

- `bun run test:profiles`: 13 tests passed, including missing/invalid values,
  public-key whitelisting, profile isolation, and local web/API origin agreement.
- `bun run --cwd apps/macos test`: 120 cases passed, including configuration
  resolution, bundle bootstrap, preference restoration, Keychain lifecycle,
  refresh, stale responses, account switching, drafts and uncertain saves.
  Test fixtures explicitly inject empty bundle configuration to remain offline.
- macOS lint, package build, the original Xcode DerivedData build, and
  `git diff --check` passed.
- A separate ad-hoc signed build at
  `/tmp/timer-focus-auth-sandbox-build/Build/Products/Debug/TimerMac.app`
  passed. Its inspected signature includes `com.apple.security.app-sandbox` and
  network-client entitlements; its bundle contains the matching public provider.
- Normal launch at the original Xcode path showed no configuration error;
  **Sign in** opened the native email/password form. The user entered credentials
  directly in the app. Authentication succeeded and loaded the running
  **leetcode** session and completed September 5 **f** session.
- Quit/relaunch at the same original path restored the account and both sessions
  without another password prompt. Launching the signed sandbox build also
  restored the account/sessions; its previously empty provider preferences were
  populated from the bundle. The signed artifact was confirmed as the sole
  running Timer process during that check.
- **Sign out** cleared the account and session list without an error. Normal
  relaunch at the original Xcode path remained signed out. Entering and clearing
  a temporary intention while signed out worked; no Focus session was created
  by the verification actions.
- Immediately before the replacement/restart sequence, stopwatch revision was
  50 with zero queued/unconfirmed actions. Those values stayed unchanged through
  authentication, restarts and sign-out; the stopwatch kept ticking. No timer
  start/pause/reset or Focus mutation was issued by these acceptance steps.
- The final running app is the updated original Xcode-path build, signed out
  with its email/password form open. The temporary sandbox build is stopped.

Production acceptance is blocked by the absent `apps/web/.env.prod-api.local`
values named above. Local configuration and the requested local live sequence
are verified; production profile validation was checked to fail closed, and no
hosted credentials or configuration were modified.

