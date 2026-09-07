import { useEffect, useEffectEvent, useRef } from "react";

import type { SocketConnectionStatus } from "./timer-sync";
import { createWebSocketTransport } from "./web-socket-transport";

export interface UseWebSocketOptions {
  onMessage: (data: unknown) => void;
  onOpen?: () => void;
  onStatusChange?: (status: SocketConnectionStatus) => void;
  onSent?: (data: string) => void;
  reconnectDelayMs?: number;
  url: string | undefined;
}

export type SendWebSocketMessage = (data: string) => void;

export function useWebSocket({
  onMessage,
  onOpen,
  onStatusChange,
  onSent,
  reconnectDelayMs = 1_000,
  url,
}: UseWebSocketOptions): SendWebSocketMessage {
  const transportRef = useRef<ReturnType<
    typeof createWebSocketTransport
  > | null>(null);
  const handleMessage = useEffectEvent((data: unknown) => onMessage(data));
  const handleOpen = useEffectEvent(() => onOpen?.());
  const handleStatus = useEffectEvent((status: SocketConnectionStatus) =>
    onStatusChange?.(status),
  );
  const handleSent = useEffectEvent((data: string) => onSent?.(data));
  const readReconnectDelay = useEffectEvent(() => reconnectDelayMs);

  useEffect(() => {
    if (!url) {
      handleStatus("offline");
      return;
    }
    const transport = createWebSocketTransport({
      url,
      reconnectDelayMs: readReconnectDelay(),
      getReconnectDelayMs: readReconnectDelay,
      onMessage: handleMessage,
      onOpen: handleOpen,
      onStatusChange: handleStatus,
      onSent: handleSent,
    });
    transportRef.current = transport;
    return () => {
      transport.dispose();
      transportRef.current = null;
    };
  }, [url]);

  return (data: string) => transportRef.current?.send(data);
}
