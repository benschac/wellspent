import { afterEach, describe, expect, it } from "bun:test";
import { createWebSocketTransport } from "../src/web-socket-transport";

class FakeSocket extends EventTarget {
  readyState = 0;
  sent: string[] = [];
  failSend = false;
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  send(message: string) {
    if (this.failSend) throw new Error("send failed");
    this.sent.push(message);
  }
  close() {
    this.readyState = 3;
  }
  remoteClose(code = 1006) {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
  }
  message(data: string) {
    this.dispatchEvent(Object.assign(new Event("message"), { data }));
  }
}
function socketAt(sockets: FakeSocket[], index: number): FakeSocket {
  const socket = sockets[index];
  if (!socket) throw new Error(`Missing test socket ${index}`);
  return socket;
}
const transports: ReturnType<typeof createWebSocketTransport>[] = [];
afterEach(() => {
  for (const transport of transports.splice(0)) transport.dispose();
});
function subject(getReconnectDelayMs?: () => number) {
  const sockets: FakeSocket[] = [];
  const statuses: string[] = [];
  const messages: unknown[] = [];
  const sent: string[] = [];
  const transport = createWebSocketTransport({
    url: "ws://localhost/api/ws",
    reconnectDelayMs: 5,
    getReconnectDelayMs,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    onMessage: (data) => messages.push(data),
    onOpen: () => {},
    onStatusChange: (status) => statuses.push(status),
    onSent: (data) => sent.push(data),
  });
  transports.push(transport);
  return { transport, sockets, statuses, messages, sent };
}
describe("WebSocket lifecycle", () => {
  it("reads updated retry timing without recreating the connection or losing queued work", async () => {
    let delay = 1000;
    const { transport, sockets } = subject(() => delay);
    transport.send("queued before delay change");
    delay = 5;
    socketAt(sockets, 0).remoteClose();
    await Bun.sleep(15);
    socketAt(sockets, 1).open();
    expect(socketAt(sockets, 1).sent).toEqual(["queued before delay change"]);
  });

  it("buffers only unsent work and flushes once after opening", async () => {
    const { transport, sockets, sent, statuses } = subject();
    transport.send("queued");
    expect(sent).toEqual([]);
    socketAt(sockets, 0).open();
    expect(sent).toEqual(["queued"]);
    socketAt(sockets, 0).remoteClose();
    await Bun.sleep(15);
    socketAt(sockets, 1).open();
    expect(socketAt(sockets, 1).sent).toEqual([]);
    expect(statuses).toEqual(["connecting", "open", "offline", "open"]);
  });

  it("ignores obsolete socket messages and stops retries on cleanup", async () => {
    const { transport, sockets, messages } = subject();
    socketAt(sockets, 0).open();
    socketAt(sockets, 0).remoteClose();
    await Bun.sleep(15);
    socketAt(sockets, 0).message("stale");
    socketAt(sockets, 1).open();
    socketAt(sockets, 1).message("current");
    expect(messages).toEqual(["current"]);
    transport.dispose();
    socketAt(sockets, 1).remoteClose();
    await Bun.sleep(15);
    expect(sockets).toHaveLength(2);
    expect(socketAt(sockets, 1).readyState).toBe(3);
  });

  it("does not replay a command whose send threw", async () => {
    const { transport, sockets, statuses, sent } = subject();
    socketAt(sockets, 0).open();
    socketAt(sockets, 0).failSend = true;
    transport.send("uncertain");
    expect(statuses.at(-1)).toBe("offline");
    expect(sent).toEqual(["uncertain"]);
    await Bun.sleep(15);
    socketAt(sockets, 1).open();
    expect(socketAt(sockets, 1).sent).toEqual([]);
  });

  it("surfaces socket errors and storage-error close codes", () => {
    const first = subject();
    socketAt(first.sockets, 0).dispatchEvent(new Event("error"));
    expect(first.statuses.at(-1)).toBe("offline");
    const second = subject();
    socketAt(second.sockets, 0).remoteClose(1011);
    expect(second.statuses.at(-1)).toBe("error");
  });

  it("clears old queues instead of sending them to another endpoint", () => {
    const first = subject();
    first.transport.send("old endpoint work");
    first.transport.dispose();
    const second = subject();
    socketAt(second.sockets, 0).open();
    expect(socketAt(second.sockets, 0).sent).toEqual([]);
  });

  it("reports malformed endpoint construction and handshake timeouts", async () => {
    const statuses: string[] = [];
    const common = {
      url: "bad",
      reconnectDelayMs: 1000,
      onMessage: () => {},
      onOpen: () => {},
      onSent: () => {},
      onStatusChange: (s: string) => statuses.push(s),
    };
    const invalid = createWebSocketTransport({
      ...common,
      createSocket: () => {
        throw new Error("private URL");
      },
    });
    transports.push(invalid);
    expect(statuses.at(-1)).toBe("error");
    const stalled = createWebSocketTransport({
      ...common,
      createSocket: () => new FakeSocket() as unknown as WebSocket,
      connectTimeoutMs: 5,
    });
    transports.push(stalled);
    await Bun.sleep(15);
    expect(statuses.at(-1)).toBe("offline");
  });
});
