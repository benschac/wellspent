# Native HTTP contract

`packages/api-contract/src/native-openapi.ts` exports the existing focus and
work-log oRPC contracts as OpenAPI 3.1.1. The checked-in artifact is
`packages/api-contract/openapi.native.json`. Generate it locally without starting
the API, accessing a database, or supplying credentials:

```sh
bun run --cwd packages/api-contract openapi:generate
bun run --cwd packages/api-contract openapi:check
bun run --cwd packages/api-contract test:openapi
```

The document uses `/api` as the server base path, matching the Nest global prefix
in `apps/api/src/main.ts`. The HTTP controllers live in `apps/api/src`; the
`apps/api/api` directory holds Vercel entrypoints, not the shared API contract.
There is no new deployed specification endpoint.

Bearer authentication is required. Focus reads and mutations require an account
access token; capture credentials authorize only the capture ingestion endpoint.
Work-log reads and ingestion accept account access tokens or work-log credentials;
token management requires an account access token. A bearer security declaration
does not mean that these credentials are interchangeable.

## Swift integration status

The macOS app still uses its existing handwritten `FocusAPIClient` and response
models. The specification export does not yet generate or wire a Swift client.
The proposed next step is Apple's Swift OpenAPI Generator with OpenAPI Runtime
and URLSession transport, pending dependency authorization. Keep generation
repeatable and check generated output for drift when changing the shared contract.

Preserve the current authentication, redirect policy, timestamp parsing,
idempotent mutation retries, and account-switch guards when integrating generated
responses. Verify the macOS client with injected HTTP responses and an Xcode
build/test run. Live API and device acceptance remain separate checks.

This HTTP document does not describe the separate `/api/ws` timer protocol.
