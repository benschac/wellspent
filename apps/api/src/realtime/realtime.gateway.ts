import { UseFilters } from "@nestjs/common";
import type { WsResponse } from "@nestjs/websockets";
import {
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import {
  type RealtimePing,
  type RealtimePong,
  type RealtimeTimerCommand,
  type RealtimeTimerLiveActivityRegistration,
  type RealtimeTimerState,
  realtimePingEvent,
  realtimePongEvent,
  realtimeTimerCommandEvent,
  realtimeTimerLiveActivityRegisterEvent,
  realtimeTimerStateEvent,
} from "@repo/api-contract";
import { LiveActivityPushService } from "./live-activity-push.service.js";
import { RealtimeService } from "./realtime.service.js";
import { RealtimeLiveActivityRegistrationPipe } from "./realtime-live-activity-registration.pipe.js";
import { RealtimePingPipe } from "./realtime-ping.pipe.js";
import { RealtimeTimerCommandPipe } from "./realtime-timer-command.pipe.js";
import { RealtimeWsExceptionFilter } from "./realtime-ws-exception.filter.js";

interface NativeWebSocketClient {
  readonly readyState: number;
  send(data: string): void;
}

interface NativeWebSocketServer {
  readonly clients: Iterable<NativeWebSocketClient>;
}

@WebSocketGateway({
  path: "/api/ws",
  maxPayload: 16 * 1024,
  perMessageDeflate: false,
})
@UseFilters(RealtimeWsExceptionFilter)
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server!: NativeWebSocketServer;

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly liveActivityPushService: LiveActivityPushService,
  ) {}

  handleConnection(client: NativeWebSocketClient): void {
    this.sendTimerState(client, this.realtimeService.getTimerState());
  }

  @SubscribeMessage(realtimePingEvent)
  handlePing(
    @MessageBody(RealtimePingPipe) ping: RealtimePing,
  ): WsResponse<RealtimePong> {
    return {
      event: realtimePongEvent,
      data: this.realtimeService.createPong(ping),
    };
  }

  @SubscribeMessage(realtimeTimerCommandEvent)
  handleTimerCommand(
    @MessageBody(RealtimeTimerCommandPipe) command: RealtimeTimerCommand,
  ): void {
    this.realtimeService.applyTimerCommand(command);
  }

  @SubscribeMessage(realtimeTimerLiveActivityRegisterEvent)
  handleLiveActivityRegistration(
    @MessageBody(RealtimeLiveActivityRegistrationPipe)
    registration: RealtimeTimerLiveActivityRegistration,
  ): void {
    this.liveActivityPushService.register(registration);
  }

  broadcastTimerState(state: RealtimeTimerState): void {
    for (const client of this.server.clients) {
      if (client.readyState === 1) {
        this.sendTimerState(client, state);
      }
    }
  }

  private sendTimerState(
    client: NativeWebSocketClient,
    state: RealtimeTimerState,
  ): void {
    client.send(
      JSON.stringify({
        event: realtimeTimerStateEvent,
        data: state,
      }),
    );
  }
}
