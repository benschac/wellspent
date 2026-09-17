# API client

`@repo/api-client` is the private workspace package for typed HTTP access to the
Wellspent API. It consumes `@repo/api-contract`; it does not own authentication
sessions, durable queues, capture adapters, or server persistence.

## Entry points

| Import | Use |
| --- | --- |
| `@repo/api-client` | `createApiClient`, `createApiQueryUtils`, `streamAssistantChat`, Google integration client, and selected Focus schemas/events |
| `@repo/api-client/work-log` | `createWorkLogClient` and work-log types/schemas without the browser query or assistant adapters |

Add `"@repo/api-client": "workspace:*"` to a consuming workspace's dependencies.
The package exports TypeScript source directly; consumers must support that
workspace convention. It is not currently a published SDK.

## Account-authenticated requests

Pass the API **origin**, such as `http://localhost:3001`, without an `/api` suffix.
The client adds that prefix. Supply a callback owned by the application's auth
layer so every request can use the current access token:

```ts
import { createApiClient, createApiQueryUtils } from "@repo/api-client";

export function createAccountApi(
  origin: string,
  getAccessToken: () => Promise<string | null>,
) {
  const api = createApiClient(origin, { getAccessToken });
  return { api, queries: createApiQueryUtils(api) };
}

export async function loadSessions(
  origin: string,
  getAccessToken: () => Promise<string | null>,
) {
  const { api } = createAccountApi(origin, getAccessToken);
  return api.focus.list();
}
```

The factory also exposes `health`, `profile`, `assistant`, and `workLog` methods
from the shared contract. With no token, it sends no Authorization header; it
does not sign in, refresh credentials, or bypass protected endpoints. Account
switching, cache isolation, and auth recovery remain the caller's responsibility.

`createApiQueryUtils(api)` supplies TanStack Query helpers. It does not create a
QueryClient or install a provider. `streamAssistantChat(api, input, signal)`
adapts the assistant's async response iterator to a data stream; it is separate
from private local recording and future encrypted sync.

## Work-log transport

```ts
import { createWorkLogClient } from "@repo/api-client/work-log";

export async function readRecentWork(
  origin: string,
  getAccessToken: () => Promise<string | null>,
) {
  const client = createWorkLogClient(origin, { getAccessToken });
  return client.list({ limit: 20 });
}
```

This entry point requires a credential callback and rejects a missing token
before sending. Its fetch wrapper refuses redirects, omits cookies, disables
request caching, and applies a ten-second timeout alongside caller cancellation.
An optional `fetch` override supports transport tests.

Work-log identity, reads, and ingestion accept an account access token or a
scoped work-log credential. Credential creation/listing/revocation require an
account access token. Focus capture credentials do not authorize work-log access.

The client does not queue or retry entries. The CLI/MCP adapter owns the private
spool, stable IDs, and delivery retries; see [work-log setup](../../docs/work-log.md).
Ingestion returns both `acceptedEventIds` and `rejectedEvents`: an HTTP success
does not mean every entry was accepted. Preserve the original ID and content
when retrying an entry.

## Google integrations

`createGoogleIntegrationsClient(origin, { getAccessToken })` is exported from the
main entry point. Its methods cover connection status, connect/disconnect,
selected-session Sheets export, Calendar publication, and publication status.
The application's auth layer supplies an account token. Server feature flags
and provider configuration determine availability.

These are separately implemented REST endpoints, not methods generated from
`apiContract`. The client validates returned links and selected response fields;
it does not perform the provider OAuth flow itself.

## Errors and ownership

Transport/authentication failures reject the request promise. Callers should
handle them at their UI or command boundary, present a suitable retry/sign-in
state, and avoid logging credentials or private payloads. Do not automatically
retry mutations with new IDs. The general API factory does not add the work-log
entry point's explicit timeout/redirect policy.

- HTTP routes and schemas: [API contract](../api-contract/README.md).
- Server authorization and persistence: `apps/api/src`.
- Browser Focus command replay: `apps/web/app/focus`.
- CLI/MCP queue and commands: `integrations/work-log`.
- Metadata capture and local native delivery: [Codex integration](../../integrations/codex/README.md).

From the repository root, check this package with:

```sh
bun run --cwd packages/api-client typecheck
bun run --cwd packages/api-client lint
```
