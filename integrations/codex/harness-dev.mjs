#!/usr/bin/env node
// Stable Node entry point for the self-contained TypeScript development bundle.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main, safeError } from "./harness-dev.generated.mjs";

export * from "./harness-dev.generated.mjs";

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const code = safeError(error);
    process.stderr.write(
      code === "storage_busy"
        ? "AI Harness dev runner is already running; use that terminal or stop it before starting another.\n"
        : code === "codex_unavailable"
          ? "Codex CLI was not found. Install Codex or make its executable available on PATH, then retry Connect in Wellspent.\n"
          : `AI Harness dev runner: ${code}.\n`,
    );
    process.exitCode = 1;
  });
}
