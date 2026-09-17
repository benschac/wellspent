# API contract

`@repo/api-contract` owns shared TypeScript HTTP contracts, runtime schemas, and
realtime message definitions. The API implements these contracts;
[`@repo/api-client`](../api-client/README.md) consumes them for typed HTTP calls.
Business-domain Focus schemas come from `@repo/session-domain` and are re-exported
here rather than duplicated.

This is a private workspace package exporting TypeScript source. Consumers use
`@repo/api-contract` after declaring it as a `workspace:*` dependency.

## Contract surface

| Surface | Owner | Coverage |
| --- | --- | --- |
| `apiContract.focus` / `focusContract` | `src/contract.ts` | Session list/create/detail, transitions, recap updates, notes, capture tokens, work-event ingestion |
| `apiContract.workLog` / `workLogContract` | `src/work-log.ts` | Account work-log identity, ingestion, pagination, credential management |
| `apiContract.health`, `.profile`, `.assistant` | `src/contract.ts` | Health, account profile, streaming assistant |
| Realtime event names and schemas | `src/contract.ts`, `src/focus-notifications.ts` | Shared stopwatch wire messages and Focus change notifications |

The shared stopwatch and durable Focus history are separate systems. A realtime
`commandId` correlates a response; it is not a durable mutation idempotency key.
Schema availability does not implement transport, authorization, or persistence.

For example, adapters can validate a work-log event before handing it to a client:

```ts
import { workLogEventInputSchema } from "@repo/api-contract";

export function validateWorkEvent(input: unknown) {
  const result = workLogEventInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error("Invalid work-log event");
  }
  return result.data;
}
```

This validates shape, not server acceptance. Timestamp/session association,
ownership, ID conflicts, and mutation revision rules require server checks.

## Native OpenAPI artifact

[`openapi.native.json`](openapi.native.json) is generated from the Focus and
work-log contracts by `src/native-openapi.ts`. It uses OpenAPI **3.1.1**, `/api`
as its server base, and a bearer security declaration. It is a checked-in build
artifact; edit the source contracts and regenerate it rather than editing JSON.

From the repository root:

```sh
bun run --cwd packages/api-contract openapi:generate
bun run --cwd packages/api-contract openapi:check
bun run --cwd packages/api-contract test:openapi
```

Generation needs installed workspace dependencies, but no running API, database,
or credentials. `openapi:check` compares regenerated content with the checked-in
artifact. The tests check selected route/input mapping and response schemas;
neither check establishes live endpoint behavior.

The artifact excludes health, profile, streaming assistant, Google integration
REST routes, and the `/api/ws` protocol. It is not a complete API inventory and
does not create a deployed specification endpoint. Native Swift currently uses
a handwritten client; this export does not install or generate a Swift SDK.
See [native HTTP integration status](../../docs/native-openapi.md).

## Authentication boundaries

| Operation | Credential |
| --- | --- |
| Focus history, session mutations, capture-token management | Account access token |
| Focus capture ingestion | Session-scoped capture credential |
| Work-log identity, reads, ingestion | Account access token or scoped work-log credential |
| Work-log credential management | Account access token |

The generic bearer scheme does not make these credentials interchangeable.
The owning controllers and repositories in `apps/api/src/focus` and
`apps/api/src/work-log` enforce the restrictions.

## Changing the contract

1. Update the owning domain schema or contract and its API implementation.
2. Update callers and tests for behavior or compatibility changes.
3. Regenerate the native artifact if Focus or work-log schemas changed.
4. Run contract checks and the affected consumer/server checks from the
   [verification guide](../../docs/verification.md).

Package-level static checks:

```sh
bun run --cwd packages/api-contract typecheck
bun run --cwd packages/api-contract lint
```

This package describes today's server API and existing wire protocols. The
[target architecture](../../docs/design/2026-09-17-wellspent-system-design.md)
proposes additional private replication and Rust boundaries; those protocols
are not implemented by this contract.
