import { useCallback, useEffect, useEffectEvent, useRef } from "react";

import { useEventListener } from "./use-event-listener";
import { useSetTimeout } from "./use-set-timeout";

export interface UseWebSocketOptions {
  onMessage: (data: unknown) => void;
  onOpen?: () => void;
  reconnectDelayMs?: number;
  url: string | undefined;
}

export type SendWebSocketMessage = (data: string) => void;

export function useWebSocket({
  onMessage,
  onOpen,
  reconnectDelayMs = 1_000,
  url,
}: UseWebSocketOptions): SendWebSocketMessage {
  const pendingMessagesRef = useRef<string[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const handleMessage = useEffectEvent((data: unknown) => onMessage(data));
  const handleOpen = useEffectEvent(() => onOpen?.());
  const listen = useEventListener();
  const {
    clear: clearReconnectTimeout,
    schedule: scheduleReconnect,
  } = useSetTimeout();

  useEffect(() => {
    if (!url) {
      return;
    }

    let shouldReconnect = true;

    const connect = () => {
      const socket = new WebSocket(url);
      socketRef.current = socket;

      const removeOpenListener = listen(socket, "open", () => {
        if (socketRef.current !== socket) {
          return;
        }

        handleOpen();

        const pendingMessages = pendingMessagesRef.current;
        pendingMessagesRef.current = [];

        for (const message of pendingMessages) {
          socket.send(message);
        }
      });
      const removeMessageListener = listen(socket, "message", (event) => {
        if (socketRef.current === socket) {
          handleMessage(event.data);
        }
      });
      const removeCloseListener = listen(socket, "close", () => {
        removeOpenListener();
        removeMessageListener();
        removeCloseListener();

        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        if (shouldReconnect) {
          scheduleReconnect(connect, reconnectDelayMs);
        }
      });
    };

    connect();

    return () => {
      shouldReconnect = false;
      pendingMessagesRef.current = [];
      clearReconnectTimeout();

      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [clearReconnectTimeout, listen, reconnectDelayMs, scheduleReconnect, url]);

  return useCallback(
    (data: string) => {
      if (!url) {
        return;
      }

      const socket = socketRef.current;

      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(data);
      } else {
        pendingMessagesRef.current.push(data);
      }
    },
    [url],
  );
}
