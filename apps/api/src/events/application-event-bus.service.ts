import { Injectable } from "@nestjs/common";
import { EventEmitter } from "eventemitter3";

type EventListener<Payload> = (payload: Payload) => void;

@Injectable()
export class ApplicationEventBus {
  private readonly emitter = new EventEmitter();

  publish<Payload>(event: string, payload: Payload): void {
    this.emitter.emit(event, payload);
  }

  subscribe<Payload>(
    event: string,
    listener: EventListener<Payload>,
  ): () => void {
    this.emitter.on(event, listener);

    return () => {
      this.emitter.off(event, listener);
    };
  }
}
