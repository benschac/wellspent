#!/usr/bin/env node
// Stable Node entry point for the self-contained TypeScript harness bundle.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./harness-helper.generated.mjs";

export * from "./harness-helper.generated.mjs";

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    process.stderr.write(
      "Local AI Harness operation failed; existing connection and evidence were preserved.\n",
    );
    process.exitCode = 1;
  });
}
