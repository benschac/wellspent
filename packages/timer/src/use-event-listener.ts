import { useEffect, useRef } from "react";

export type RemoveEventListener = () => void;

export interface ListenForEvent {
  <EventName extends keyof WebSocketEventMap>(
    target: WebSocket,
    eventName: EventName,
    listener: (event: WebSocketEventMap[EventName]) => void,
    options?: boolean | AddEventListenerOptions,
  ): RemoveEventListener;
  <EventType extends Event = Event>(
    target: EventTarget,
    eventName: string,
    listener: (event: EventType) => void,
    options?: boolean | AddEventListenerOptions,
  ): RemoveEventListener;
}

export function useEventListener(): ListenForEvent {
  const removersRef = useRef(new Set<RemoveEventListener>());

  useEffect(
    () => () => {
      for (const remove of removersRef.current) {
        remove();
      }

      removersRef.current.clear();
    },
    [],
  );

  return (<EventType extends Event>(
    target: EventTarget,
    eventName: string,
    listener: (event: EventType) => void,
    options?: boolean | AddEventListenerOptions,
  ) => {
    const eventListener = listener as EventListener;
    let isListening = true;

    target.addEventListener(eventName, eventListener, options);

    const remove = () => {
      if (!isListening) {
        return;
      }

      isListening = false;
      target.removeEventListener(eventName, eventListener, options);
      removersRef.current.delete(remove);
    };

    removersRef.current.add(remove);

    return remove;
  }) as ListenForEvent;
}
