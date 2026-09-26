import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decode, sign } from "./local-contract.mjs";
import {
  enqueueTelemetry,
  openLocalRoot,
  serve,
  setup,
} from "./local-helper.mjs";
import { TELEMETRY_PREVIEW_LIMITS } from "./telemetry-contract.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("../../docs/design/probes/c3a/fixture.json", import.meta.url),
  ),
);
const key = Buffer.alloc(32, 42);

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

test("real HTTP preview pages original pending packets without consuming or crossing bindings", async (t) => {
  const path = await mkdtemp(
    join(await realpath(tmpdir()), "wellspent-preview-"),
  );
  await chmod(path, 0o700);
  t.after(() => rm(path, { recursive: true, force: true }));
  const root = await openLocalRoot(path);
  const endpoint = `http://127.0.0.1:${await availablePort()}`;
  const now = new Date();
  const bundle = {
    version: 1,
    endpoint,
    key: key.toString("base64"),
    binding: {
      ...fixture.binding,
      issuedAt: now.toISOString(),
      acceptUntil: new Date(now.getTime() + 7 * 86400000).toISOString(),
    },
  };
  const second = {
    ...bundle,
    binding: {
      ...bundle.binding,
      bindingID: randomUUID(),
      threadID: "other-thread",
    },
  };
  await setup(root, bundle);
  await setup(root, second);
  const input = (turnID) => ({
    sourceVersion: "0.157.1",
    kind: "turnConfiguration",
    sessionID: "synthetic",
    rootTurnID: "root",
    turnID,
    sourceWrittenAt: now.toISOString(),
    configuredModel: "synthetic-model",
    configuredEffort: "high",
  });
  for (let i = 0; i < 19; i++)
    await enqueueTelemetry(
      root,
      bundle.binding.bindingID,
      input(`turn-${i}`),
      now,
    );
  await enqueueTelemetry(
    root,
    second.binding.bindingID,
    input("isolated"),
    now,
  );
  const pendingDirectory = join(root, "telemetry-pending");
  const names = (await readdir(pendingDirectory)).sort();
  const originals = await Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(join(pendingDirectory, name))),
    ),
  );
  const expected = originals.filter(
    (packet) => decode(packet).value.bindingID === bundle.binding.bindingID,
  );
  const server = await serve(root);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = (cursor = null, domain = "telemetry-preview") =>
    sign(
      {
        version: 1,
        bindingID: bundle.binding.bindingID,
        nonce: randomUUID(),
        issuedAt: new Date().toISOString(),
        cursor,
      },
      key,
      domain,
    );
  const post = async (packet, route = "/v2/preview") =>
    fetch(`${endpoint}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(packet),
    });
  const firstRequest = request();
  const firstHTTP = await post(firstRequest);
  assert.equal(firstHTTP.status, 200);
  const firstText = await firstHTTP.text();
  assert.ok(Buffer.byteLength(firstText) <= TELEMETRY_PREVIEW_LIMITS.bytes);
  const first = JSON.parse(firstText);
  assert.equal(first.packets.length, 16);
  assert.equal(
    first.nextCursor,
    decode(first.packets.at(-1)).value.observationID,
  );
  const lastHTTP = await post(request(first.nextCursor));
  assert.equal(lastHTTP.status, 200);
  const last = await lastHTTP.json();
  assert.equal(last.nextCursor, null);
  assert.equal(last.packets.length, 3);
  assert.deepEqual([...first.packets, ...last.packets], expected);
  assert.equal((await post(firstRequest)).status, 400, "replay rejected");
  assert.equal(
    (await post(request("../private"))).status,
    400,
    "invalid cursor rejected",
  );
  assert.equal(
    (await post(request(null, "telemetry-poll"))).status,
    400,
    "wrong signature domain rejected",
  );
  assert.deepEqual((await readdir(pendingDirectory)).sort(), names);
  assert.deepEqual(await readdir(join(root, "telemetry-receipts")), []);
  for (let i = 0; i < names.length; i++)
    assert.deepEqual(
      JSON.parse(await readFile(join(pendingDirectory, names[i]))),
      originals[i],
    );
  const poll = sign(
    {
      version: 1,
      bindingID: bundle.binding.bindingID,
      nonce: randomUUID(),
      issuedAt: new Date().toISOString(),
    },
    key,
    "telemetry-poll",
  );
  assert.deepEqual(
    (await (await post(poll, "/v2/poll")).json()).packet,
    expected[0],
    "ordinary commit/ACK delivery still starts at first packet",
  );
});
