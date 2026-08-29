import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway.js";
import { RealtimePingPipe } from "./realtime-ping.pipe.js";
import { RealtimeService } from "./realtime.service.js";
import { RealtimeWsExceptionFilter } from "./realtime-ws-exception.filter.js";

@Module({
  providers: [
    RealtimeGateway,
    RealtimePingPipe,
    RealtimeService,
    RealtimeWsExceptionFilter,
  ],
})
export class RealtimeModule {}
