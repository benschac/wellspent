#!/usr/bin/env node
// Stable Node entry point for installed Codex connections. Implementation is TS.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./harness-mcp.generated.mjs";

export { createMcpServer, stdio } from "./harness-mcp.generated.mjs";

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write("Local AI Harness unavailable.\n");
    process.exitCode = 1;
  });
}
