// Codex proxy is a raw Unix-socket byte bridge. Its control socket speaks
// WebSocket, not the newline transport used by a newly launched app-server.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

export function openCodexProxy(codex, limits, onMessage, onFailure) {
  const child = spawn(codex, ["app-server", "proxy"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const key = randomBytes(16).toString("base64");
  const expected = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  let buffer = Buffer.alloc(0),
    fragments = [],
    fragmentBytes = 0,
    bytes = 0;
  let upgraded = false,
    closed = false;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  function close() {
    if (closed) return;
    closed = true;
    rejectReady(new Error("api_unavailable"));
    buffer = Buffer.alloc(0);
    fragments = [];
    child.stdin.destroy();
    child.stdout.destroy();
    child.kill(); // Only the bridge created here; never the existing daemon.
  }
  function fail(code) {
    if (closed) return;
    rejectReady(new Error(code));
    onFailure(code);
    close();
  }
  function frame(opcode, data) {
    if (closed) throw new Error("api_unavailable");
    const mask = randomBytes(4);
    const header = Buffer.alloc(data.length < 126 ? 6 : 8);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | (data.length < 126 ? data.length : 126);
    if (data.length >= 126) header.writeUInt16BE(data.length, 2);
    mask.copy(header, header.length - 4);
    const payload = Buffer.from(data);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    child.stdin.write(Buffer.concat([header, payload]));
  }
  child.on("error", () => fail("api_unavailable"));
  child.on("exit", () => fail("api_unavailable"));
  child.stdin.on("error", () => fail("api_unavailable"));
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > limits.responseBytes) return fail("api_response_limit");
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) {
        if (buffer.length > 8192) fail("api_protocol");
        return;
      }
      const headers = buffer.subarray(0, end).toString("ascii").split("\r\n");
      const accept = headers
        .find((line) => /^sec-websocket-accept:/i.test(line))
        ?.split(":")
        .slice(1)
        .join(":")
        .trim();
      if (
        end > 8192 ||
        !/^HTTP\/1\.1 101 /.test(headers[0]) ||
        accept !== expected
      )
        return fail("api_protocol");
      buffer = buffer.subarray(end + 4);
      upgraded = true;
      resolveReady();
    }
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0,
        opcode = buffer[0] & 15;
      if (buffer[0] & 0x70 || buffer[1] & 0x80) return fail("api_protocol");
      let length = buffer[1] & 127,
        offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const wide = buffer.readBigUInt64BE(2);
        if (wide > BigInt(limits.lineBytes)) return fail("api_response_limit");
        length = Number(wide);
        offset = 10;
      }
      if (length > limits.lineBytes) return fail("api_response_limit");
      if (buffer.length < offset + length) return;
      const payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);
      if (opcode >= 8) {
        if (!fin || length > 125) return fail("api_protocol");
        if (opcode === 8) return fail("api_unavailable");
        if (opcode === 9) frame(10, payload);
        else if (opcode !== 10) return fail("api_protocol");
        continue;
      }
      if (
        (opcode !== 0 && opcode !== 1) ||
        (opcode === 0 && fragments.length === 0) ||
        (opcode === 1 && fragments.length > 0)
      )
        return fail("api_protocol");
      fragmentBytes += payload.length;
      if (fragmentBytes > limits.lineBytes || fragments.length >= 1024)
        return fail("api_response_limit");
      fragments.push(payload);
      if (!fin) continue;
      let message;
      try {
        message = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(fragments),
          ),
        );
      } catch {
        return fail("api_protocol");
      }
      fragments = [];
      fragmentBytes = 0;
      onMessage(message);
    }
  });
  child.stdin.write(
    `GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  return {
    ready,
    close,
    bytesRead: () => bytes,
    send: (message) => frame(1, Buffer.from(JSON.stringify(message))),
  };
}
