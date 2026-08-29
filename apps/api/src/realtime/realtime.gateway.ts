import { UseFilters } from "@nestjs/common";
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { WsResponse } from "@nestjs/websockets";
import {
  realtimePingEvent,
  realtimePongEvent,
  type RealtimePing,
  type RealtimePong,
} from "@repo/api-contract";
import { RealtimePingPipe } from "./realtime-ping.pipe.js";
import { RealtimeService } from "./realtime.service.js";
import { RealtimeWsExceptionFilter } from "./realtime-ws-exception.filter.js";

@WebSocketGateway({
  path: "/api/ws",
  maxPayload: 16 * 1024,
  perMessageDeflate: false,
})
@UseFilters(RealtimeWsExceptionFilter)
export class RealtimeGateway {
  constructor(private readonly realtimeService: RealtimeService) {}

  @SubscribeMessage(realtimePingEvent)
  handlePing(
    @MessageBody(RealtimePingPipe) ping: RealtimePing,
  ): WsResponse<RealtimePong> {
    return {
      event: realtimePongEvent,
      data: this.realtimeService.createPong(ping),
    };
  }
}
