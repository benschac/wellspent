import { Inject, Logger, UseFilters } from "@nestjs/common";
import type { WsResponse } from "@nestjs/websockets";
import {
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
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
  close(code: number, reason: string): void;
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
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer()
  private readonly server!: NativeWebSocketServer;

  constructor(
    @Inject(RealtimeService)
    private readonly realtimeService: RealtimeService,
    @Inject(LiveActivityPushService)
    private readonly liveActivityPushService: LiveActivityPushService,
  ) {}

  async handleConnection(client: NativeWebSocketClient): Promise<void> {
    // Nest's connection lifecycle does not route rejected promises through the
    // message exception filter. Handle storage failures here; never send zeros.
    try {
      const state = await this.realtimeService.getTimerState();
      if (client.readyState === 1) this.sendTimerState(client, state);
    } catch {
      this.logger.error("Unable to load persisted shared timer state");
      client.close(1011, "Timer storage unavailable");
    }
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
  async handleTimerCommand(
    @MessageBody(RealtimeTimerCommandPipe) command: RealtimeTimerCommand,
  ): Promise<void> {
    try {
      await this.realtimeService.applyTimerCommand(command);
    } catch {
      this.logger.error("Unable to persist shared timer command");
      throw new WsException({
        code: "TIMER_UNAVAILABLE",
        message: "Timer state could not be saved. Reconnect and try again.",
      });
    }
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
