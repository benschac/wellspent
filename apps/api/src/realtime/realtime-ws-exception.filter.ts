import {
  type ArgumentsHost,
  Catch,
  type WsExceptionFilter,
} from "@nestjs/common";
import { WsException } from "@nestjs/websockets";

interface NativeWebSocketClient {
  send(data: string): void;
}

@Catch(WsException)
export class RealtimeWsExceptionFilter
  implements WsExceptionFilter<WsException>
{
  catch(exception: WsException, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<NativeWebSocketClient>();
    const error = exception.getError();
    const data =
      typeof error === "string" ? { status: "error", message: error } : error;

    client.send(JSON.stringify({ event: "exception", data }));
  }
}
