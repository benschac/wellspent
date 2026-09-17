# Local Honcho

Private workspace package for Honcho's Docker lifecycle. Honcho runs as Python
containers, with its own Postgres/pgvector and Redis volumes. No JavaScript
dependencies or application integration are needed to host it.

Based on the [official self-hosting instructions](https://github.com/plastic-labs/honcho#self-hosting)
and [CLI Compose template](https://github.com/plastic-labs/honcho/blob/main/honcho-cli/src/honcho_cli/local/templates/docker-compose.yml).
The API and deriver use the pinned Honcho 3.2.0 image in `compose.yaml`.

## Setup

Requires Docker with Compose v2 or newer, running on your Mac.

1. Copy `.env.example` to `.env` in this directory.
2. Set `OPENROUTER_API_KEY` in `.env` using your editor.
   The file is gitignored. Compose maps it to Honcho's internal
   `LLM_OPENAI_API_KEY` variable. Honcho uses its OpenAI-compatible transport; all
   reasoning and embedding endpoints are explicitly routed to OpenRouter.
   The configuration uses `openai/gpt-5.4-mini` for reasoning and
   `openai/text-embedding-3-small` (1536 dimensions) for embeddings.
   [OpenRouter supports this embedding model](https://openrouter.ai/docs/api/api-reference/embeddings/create-embeddings).
   Provider usage is billed separately; submitted messages may be sent to
   OpenRouter and the selected model provider for processing.
3. From the repository root, run `bun run honcho:start`.

The API is at `http://127.0.0.1:8005`; interactive API docs are at `/docs`.
Point SDK clients at that base URL explicitly. Auth is disabled for this local
instance, and the API binds only to loopback. Do not expose it publicly as-is.
Postgres and Redis have no published host ports.

## Commands

Run from the repository root:

```sh
bun run honcho:check
bun run honcho:start
bun run honcho:status
bun run honcho:logs
bun run honcho:stop
```

These delegate through Turbo to this package; Docker lifecycle tasks are uncached.
Honcho starts explicitly, not as part of the ordinary `bun run dev` command.
`honcho:start` waits for API/database/cache health. The deriver has no upstream
healthcheck; inspect its logs and verify a real reasoning request separately.

Startup runs Honcho's migrations against its dedicated database. Stop removes
containers but preserves `timer-honcho_pgdata` and `timer-honcho_redis-data`.
Never use `docker compose down --volumes` unless you intend to erase Honcho data.
After editing `.env`, run `honcho:start` again to recreate affected containers.

```sh
curl --fail http://127.0.0.1:8005/health
```

A healthy API does not establish valid provider credentials or successful
reasoning. No Timer data or Codex conversations are automatically ingested.
This setup does not install agent hooks or change global Honcho/Codex settings.

## Verification performed

Local verification on September 17, 2026: Compose validation and Turbo task
selection passed; API, Postgres/pgvector, and Redis health checks passed, and
the deriver started its queue processor. A synthetic message was stored through
the API, received a 1536-dimensional embedding, and a peer chat request through
OpenRouter returned the expected answer. The synthetic session and workspace
were then submitted for deletion. This verifies storage, embeddings, and live
chat; background memory derivation and application integration remain untested.
