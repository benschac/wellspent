// Explicitly invoked, disposable sandbox capability proof. Never starts a persistent service.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sign } from "./contract.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "wellspent-c3a-loopback-"));
const fixture = JSON.parse(
  await readFile(new URL("./fixture.json", import.meta.url), "utf8"),
);
const key = randomBytes(32); // Disposable, not a user's credential; no key in HTTP requests.
const packet = sign(
  JSON.parse(Buffer.from(fixture.packet.body, "base64")),
  key,
);
let polls = 0;
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/poll");
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
      assert.ok(Buffer.concat(chunks).length <= 1024);
    }
    const poll = JSON.parse(Buffer.concat(chunks));
    const body = Buffer.from(poll.body, "base64");
    const expected = createHmac("sha256", key)
      .update("wellspent-c3a-poll\0")
      .update(body)
      .digest();
    const mac = Buffer.from(poll.mac, "base64");
    assert.equal(mac.length, expected.length);
    assert.ok(timingSafeEqual(mac, expected));
    assert.equal(body.toString(), "synthetic-poll");
    polls++;
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(packet));
  } catch {
    response.writeHead(403).end();
  }
});
async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve(output)
        : reject(new Error(`${command} exited ${code}: ${output}`));
    });
  });
}
try {
  const contents = join(directory, "C3aLoopback.app", "Contents");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  const binary = join(contents, "MacOS", "C3aLoopback");
  await writeFile(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.wellspent.c3a.loopback-probe</string><key>CFBundleExecutable</key><string>C3aLoopback</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
  );
  await run("xcrun", [
    "swiftc",
    "-swift-version",
    "6",
    "-strict-concurrency=complete",
    "-parse-as-library",
    "-module-cache-path",
    join(directory, "module-cache"),
    fileURLToPath(new URL("./loopback.swift", import.meta.url)),
    "-o",
    binary,
  ]);
  await run("codesign", [
    "--force",
    "--sign",
    "-",
    "--options",
    "runtime",
    "--entitlements",
    join(root, "apps/macos/TimerMac/TimerMac.entitlements"),
    join(directory, "C3aLoopback.app"),
  ]);
  await run("codesign", [
    "--verify",
    "--strict",
    join(directory, "C3aLoopback.app"),
  ]);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  console.log(
    (await run(binary, [String(address.port), key.toString("base64")])).trim(),
  );
  assert.equal(polls, 1);
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
