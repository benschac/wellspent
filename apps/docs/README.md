# Documentation site

`@repo/docs` is the local/internal Next.js and Fumadocs application. It runs without
the product API, database, provider accounts, or hosted search.

## Run

From the repository root:

```sh
bun install
bun run dev:docs
```

Open <http://127.0.0.1:3002/docs>. The dev process watches the canonical documentation
sources and rebuilds derived content. Next handles application hot reload.

```sh
bun run build --filter=@repo/docs
bun run typecheck --filter=@repo/docs
bun run lint --filter=@repo/docs
bun run test --filter=@repo/docs
bun run docs:check
bun run --cwd apps/docs start
```

Use the Turbo build/typecheck entrypoints: they prepare content first. Build also
checks the checked-in native OpenAPI artifact for drift. `docs:check` validates
page links, anchors, and assets in the actual production HTML. Stop dev before starting
the production server on the same port.

## Content ownership

Edit `docs/WELLSPENT_PLAN.md`, `docs/design`, package READMEs, and integration guides
in place. `scripts/prepare.mjs` maps those sources into `.content`, rewrites their
relative document links, and copies only explicitly referenced assets into
`public/repository`. Both outputs are ignored and disposable. Original documents
are neither moved nor overwritten. Page descriptions show the canonical path.

`source.config.ts` compiles the derived Markdown/MDX. The existing native OpenAPI
artifact generates the HTTP reference. Request execution is disabled; the docs
site does not proxy product requests or collect API credentials.

Architecture SVGs use an enlarge control and original-image links; the editable
Mermaid files remain beside the canonical documents. Search runs in the local
Next process. Historical broken source references are listed explicitly on the
unavailable-sources page, rather than presented as current architecture.

## Adding documentation

Add a canonical source and stable slug to `primary` in `scripts/prepare.mjs`, or
add Markdown under `docs` (automatically discovered). Update the watch paths and
Turbo inputs when introducing another source location. Keep one authoring copy.

The site includes internal plans and source excerpts. The default commands bind
to loopback; public deployment, access control, and selecting public content are
separate work. `robots` metadata is not authentication.
