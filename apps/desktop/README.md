# Timer desktop

Tauri 2 desktop shell for the shared `@repo/timer` package.

From the repository root:

```sh
bun run --cwd apps/desktop tauri dev
```

The timer works locally without an API. To use the shared realtime timer service,
copy `.env.example` to `.env` and set `VITE_API_URL`.

Build the frontend through Turborepo:

```sh
bunx turbo run build --filter=@repo/desktop
```

Build an installable desktop application:

```sh
bun run --cwd apps/desktop tauri build
```
