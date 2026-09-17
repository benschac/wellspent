# System-design diagrams

The seven `2026-09-17-wellspent_*.mmd` files are the editable diagram sources for the [system design](../2026-09-17-wellspent-system-design.md). Matching SVGs are validated exports. The [HTML walkthrough](../2026-09-17-wellspent-system-design.html) embeds those SVGs as data URLs and works offline; it is a dated visual snapshot, not a running product or external service.

September 17 rendering: `@mermaid-js/mermaid-cli` 11.17.0, existing Google Chrome in an isolated temporary headless profile, and [mermaid.config.json](mermaid.config.json). Temporary rendering tools were installed outside the repository; no app dependency or lockfile changed for this work. All seven exports completed successfully. Sequence labels use periods/commas rather than unescaped semicolon separators.

With Mermaid CLI available, reproduce an export from this directory:

```sh
mmdc -i 2026-09-17-wellspent_01_current.mmd \
  -o 2026-09-17-wellspent_01_current.svg \
  -c mermaid.config.json -b white
```

If using an existing browser instead of Puppeteer's bundled browser, pass `-p /path/to/puppeteer.json` with its `executablePath`. Do not reuse a personal browser profile. See the [official CLI instructions](https://github.com/mermaid-js/mermaid-cli).

When changing a diagram, rerender it and refresh the embedded copy in the HTML snapshot. The Markdown document references the SVG directly. Diagram colors aid reading, but current/target/deferred status is also stated in the text. Layout arrows and sequence order express the proposed contracts; they do not establish implemented behavior or security acceptance.
