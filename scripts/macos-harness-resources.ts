#!/usr/bin/env bun
import { $ } from "bun";
import { buildHarness } from "../integrations/codex/build.ts";

// Copy only executable source, never local connection state, credentials, or spools.
const source = `${import.meta.dir}/../integrations/codex`;
const output = Bun.argv[2];
if (!output)
  throw new Error("Supply the built app's LocalHarness resource directory");

await $`mkdir -p ${output}`;
await Promise.all(
  [
    "local-contract.mjs",
    "local-helper.mjs",
    "timer-capture.mjs",
    "harness-helper.mjs",
    "harness-mcp.mjs",
  ].map((name) =>
    Bun.write(`${output}/${name}`, Bun.file(`${source}/${name}`)),
  ),
);

// Installed Node commands run outside the checkout. Bundle every runtime
// dependency, including Execa, the MCP SDK and the local storage helpers.
await buildHarness(output, ["harness-helper.ts", "harness-mcp.ts"]);
