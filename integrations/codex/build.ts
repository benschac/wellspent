#!/usr/bin/env bun
import { basename, join } from "node:path";

const entries = ["harness-helper.ts", "harness-dev.ts", "harness-mcp.ts"];

export async function buildHarness(
  output = import.meta.dir,
  selectedEntries = entries,
) {
  for (const entry of selectedEntries) {
    const name = basename(entry, ".ts");
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, entry)],
      target: "node",
      format: "esm",
      packages: "bundle",
      outdir: output,
      naming: `${name}.generated.mjs`,
    });
    if (!build.success) {
      for (const log of build.logs) console.error(log);
      throw new Error(`Failed to build ${name}`);
    }
  }
}

if (import.meta.main) await buildHarness();
