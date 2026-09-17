# Timer recording and Codex session reuse — September 16, 2026

## Current behavior verified in source

The main Mac timer and floating widget already route local Start/Resume and Pause
through `TimerRecordingController`. Start commits a foreground recording boundary
before starting the timer; Pause immediately excludes new foreground capture and
new `log_work` admission. Reset preserves history. Remote timer updates do not
authorize local capture.

The local MCP handler holds connection identity, not recording/interval identity.
The native poll supplies the currently active interval. One discovered MCP session
can therefore serve successive intervals and recordings without being restarted.
An explicit Disconnect revokes that authorization; later reconnect creates a new
identity and must not silently revive the old session.

Automatic PostToolUse/Stop metadata is a separate path: its current grants bind a
thread to a specific recording interval. This change does not implement automatic
rebinding on resume. The user's exact observed restart trigger has not yet been
confirmed.

## Fix

An explicit repair of an unchanged MCP registration previously erased discovery
and caused another restart prompt. Preserve discovery when registration and
connection identity are unchanged; still clear it for new/revoked identities,
disabled registrations, or executable/argument changes. The native UI labels the
action Repair connection and explains that timer pauses/resumes do not require a
new Codex session.

## Verification

- `bun run --cwd integrations/codex test:harness`: 25 tests passed, zero failures/skips (loopback-enabled run).

- New synthetic HTTP/MCP test initializes/discovers once, saves a note, rejects a
  paused call, saves in a resumed interval, preserves the rejected call's status,
  then saves in a new recording using the same handler and connection identity.
- Existing repair tests now verify unchanged discovery is retained and changed
  executable discovery is cleared. Revocation tests retain old-session exclusion.
- Native UI changes are copy only; Swift lint passed. Biome and diff checks passed.
- Live installed-session behavior and automatic hook rebinding are not established
  by the synthetic test. No user connection, recording or Codex configuration was
  changed during verification.
