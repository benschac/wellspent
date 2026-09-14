import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sign } from "./contract.mjs";
import { openOutbox } from "./outbox.mjs";

const fixture = JSON.parse(
  await readFile(new URL("./fixture.json", import.meta.url), "utf8"),
);
const body = JSON.parse(Buffer.from(fixture.packet.body, "base64"));
const id = body.eventID;
const key = Buffer.from(fixture.key, "base64");
function receipt(overrides = {}) {
  return {
    eventID: id,
    bodyDigest: createHash("sha256")
      .update(Buffer.from(fixture.packet.body, "base64"))
      .digest("hex"),
    nativeReceivedAt: "2027-01-15T08:00:20.000Z",
    ...overrides,
  };
}
test("offline enqueue survives producer exit; retries preserve first bytes; only authenticated matching ACK resolves it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wellspent-c3a-outbox-"));
  try {
    const moduleURL = new URL("./outbox.mjs", import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {openOutbox} from ${JSON.stringify(moduleURL)}; const queue=await openOutbox(process.argv[1]); await queue.enqueue(JSON.parse(process.argv[2]));`,
        directory,
        JSON.stringify(fixture.packet),
      ],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    const queue = await openOutbox(directory);
    assert.deepEqual(await queue.pending(id), fixture.packet);
    await queue.enqueue(
      sign({ ...body, hookReceivedAt: "2027-01-15T08:00:09.000Z" }, key),
    );
    assert.deepEqual(await queue.pending(id), fixture.packet);
    await assert.rejects(
      queue.acknowledge(id, sign(receipt(), Buffer.alloc(32)), key),
      /untrusted_ack/,
    );
    await assert.rejects(
      queue.acknowledge(id, sign(receipt(), key, "event"), key),
      /untrusted_ack/,
    );
    await assert.rejects(
      queue.acknowledge(
        id,
        sign(receipt({ bodyDigest: "incorrect" }), key, "ack"),
        key,
      ),
      /mismatched_ack/,
    );
    assert.deepEqual(await queue.pending(id), fixture.packet);
    await queue.acknowledge(id, sign(receipt(), key, "ack"), key);
    const reopened = await openOutbox(directory);
    assert.equal(await reopened.pending(id), null);
    assert.equal(await reopened.enqueue(fixture.packet), false);
    assert.deepEqual(await readdir(directory), [`${id}.ack`]);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, `${id}.ack`), "utf8")),
      { id },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
