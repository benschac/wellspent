import { Global, Module } from "@nestjs/common";
import { ApplicationEventBus } from "./application-event-bus.service.js";

@Global()
@Module({
  providers: [ApplicationEventBus],
  exports: [ApplicationEventBus],
})
export class ApplicationEventBusModule {}
