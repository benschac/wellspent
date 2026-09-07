# Session domain

Platform-neutral focus-session schemas, elapsed-time and transition rules,
optimistic command projection, and evidence/recap projection. The API contract
re-exports the public schemas/types; browser focus state re-exports the pure
projection helpers. HTTP errors remain in the API adapter, and persistence and
command idempotency remain with their existing owners.

`@repo/session-domain/testing` supplies the same offline start/pause/resume/finish
fixtures to server and browser tests. `bun run test:focus` at the repository root
includes this package's regression tests under both Bun and Node. Source imports
use explicit `.ts` extensions, and the package typecheck requires erasable
TypeScript syntax so the API can load it directly with Node's ESM loader.

Preserved boundaries:

- HTTP command inputs reject unknown fields and trim intentions. Legacy stored
  commands strip unknown fields and preserve intention whitespace.
- Canonical transitions validate ordering and lifecycle. Optimistic replay keeps
  its existing revision-gap policy and skips commands already acknowledged by a
  newer revision; it does not replace server conflict validation.
- Commands keep their original ISO timestamps and IDs. Time arithmetic uses
  numeric milliseconds; timer transitions leave recap revisions untouched.
- Repository interfaces, IndexedDB/SQLite adapters, device sync envelopes, and
  broader session events belong to subsequent implementation steps.
