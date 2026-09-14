// Disposable C3a sender proof. Callers must supply a dedicated directory; no default user paths.
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;
async function read(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 16384)
      throw new Error("invalid_private_file");
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}
async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function publish(directory, path, value) {
  const temporary = join(directory, `${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary);
  }
  await syncDirectory(directory);
}
export async function outbox(directory) {
  await mkdir(directory, { mode: 0o700 });
  return openOutbox(directory);
}
export async function openOutbox(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("invalid_private_directory");
  function path(id, suffix) {
    if (!uuid.test(id)) throw new Error("invalid_identity");
    return join(directory, `${id}.${suffix}`);
  }
  async function acknowledged(id) {
    try {
      const ack = await read(path(id, "ack"));
      if (ack.id !== id || Object.keys(ack).length !== 1)
        throw new Error("invalid_receipt");
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  return {
    async enqueue(packet) {
      const body = JSON.parse(Buffer.from(packet.body, "base64"));
      const id = body.eventID;
      if (await acknowledged(id)) return false;
      await publish(directory, path(id, "json"), packet);
      // A retry keeps the first timestamp and bytes, including after a producer process restart.
      if (await acknowledged(id)) {
        await unlink(path(id, "json")).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        return false;
      }
      return true;
    },
    async pending(id) {
      return (await acknowledged(id)) ? null : read(path(id, "json"));
    },
    async acknowledge(id, packet, key) {
      if (await acknowledged(id)) return;
      const pending = await read(path(id, "json"));
      const bytes = Buffer.from(packet.body, "base64");
      const expected = createHmac("sha256", key)
        .update("wellspent-c3a-ack\0")
        .update(bytes)
        .digest();
      const mac = Buffer.from(packet.mac, "base64");
      if (mac.length !== expected.length || !timingSafeEqual(mac, expected))
        throw new Error("untrusted_ack");
      const receipt = JSON.parse(bytes);
      const digest = createHash("sha256")
        .update(Buffer.from(pending.body, "base64"))
        .digest("hex");
      if (receipt.eventID.toLowerCase() !== id || receipt.bodyDigest !== digest)
        throw new Error("mismatched_ack");
      await publish(directory, path(id, "ack"), { id });
      await unlink(path(id, "json")).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await syncDirectory(directory);
    },
  };
}
