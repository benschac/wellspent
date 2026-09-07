import type { SocketConnectionStatus } from "./timer-sync";

export interface WebSocketTransportOptions {
  url: string;
  reconnectDelayMs: number;
  getReconnectDelayMs?: () => number;
  onMessage: (data: unknown) => void;
  onOpen: () => void;
  onStatusChange: (status: SocketConnectionStatus) => void;
  onSent: (data: string) => void;
  createSocket?: (url: string) => WebSocket;
  connectTimeoutMs?: number;
}

/** One connection owner, with guarded callbacks and teardown on endpoint changes. */
export function createWebSocketTransport(options: WebSocketTransportOptions) {
  let socket: WebSocket | undefined;
  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  const pending: string[] = [];
  let removeListeners = () => {};

  const retry = () => {
    if (!disposed)
      reconnectTimer = setTimeout(
        connect,
        options.getReconnectDelayMs?.() ?? options.reconnectDelayMs,
      );
  };

  const disconnect = (current: WebSocket, status: SocketConnectionStatus) => {
    if (disposed || socket !== current) return;
    clearTimeout(connectTimer);
    removeListeners();
    socket = undefined;
    options.onStatusChange(status);
    current.close();
    retry();
  };

  const flush = () => {
    const current = socket;
    if (current?.readyState !== 1) return;
    while (pending.length > 0) {
      const message = pending[0];
      if (message === undefined) break;
      // Once attempted, delivery may be uncertain. Correlation IDs do not make
      // commands idempotent, so never requeue an attempted send after failure.
      pending.shift();
      options.onSent(message);
      try {
        current.send(message);
      } catch {
        disconnect(current, "offline");
        return;
      }
    }
  };

  function connect() {
    if (disposed) return;
    let current: WebSocket;
    try {
      current = options.createSocket
        ? options.createSocket(options.url)
        : new WebSocket(options.url);
    } catch {
      options.onStatusChange("error");
      retry();
      return;
    }
    socket = current;
    const open = () => {
      if (disposed || socket !== current) return;
      clearTimeout(connectTimer);
      options.onStatusChange("open");
      options.onOpen();
      flush();
    };
    const message = (event: MessageEvent) => {
      if (!disposed && socket === current) options.onMessage(event.data);
    };
    const close = (event: CloseEvent) => {
      disconnect(current, event.code === 1011 ? "error" : "offline");
    };
    const error = () => disconnect(current, "offline");
    current.addEventListener("open", open);
    current.addEventListener("message", message);
    current.addEventListener("close", close);
    current.addEventListener("error", error);
    removeListeners = () => {
      current.removeEventListener("open", open);
      current.removeEventListener("message", message);
      current.removeEventListener("close", close);
      current.removeEventListener("error", error);
    };
    connectTimer = setTimeout(
      () => disconnect(current, "offline"),
      options.connectTimeoutMs ?? 10_000,
    );
  }

  options.onStatusChange("connecting");
  connect();
  return {
    send(data: string) {
      if (disposed) return;
      pending.push(data);
      flush();
    },
    dispose() {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(connectTimer);
      removeListeners();
      socket?.close();
      socket = undefined;
      pending.length = 0;
    },
  };
}
