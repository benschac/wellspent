// Test-only launcher for the production development supervisor. The caller supplies
// one disposable root; no discovery, Codex installation, or user state is involved.

import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { startDevRunner } from "../../../integrations/codex/harness-dev.generated.mjs";

const root = process.argv[2];
if (!root?.startsWith("/")) throw new Error("disposable root required");
let port;
try {
  port = Number(await readFile(join(root, "test-port"), "utf8"));
} catch {
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  await writeFile(join(root, "test-port"), String(port), { mode: 0o600 });
}
const runner = await startDevRunner({
  directory: root,
  intervalMs: 25,
  heartbeatMs: 250,
});
await writeFile(join(root, "test-ready"), String(port), { mode: 0o600 });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await runner.stop();
  });
}
