import { Injectable, type PipeTransform } from "@nestjs/common";
import { WsException } from "@nestjs/websockets";
import {
  type RealtimeTimerCommand,
  realtimeTimerCommandSchema,
} from "@repo/api-contract";

@Injectable()
export class RealtimeTimerCommandPipe
  implements PipeTransform<unknown, RealtimeTimerCommand>
{
  transform(value: unknown): RealtimeTimerCommand {
    const result = realtimeTimerCommandSchema.safeParse(value);

    if (!result.success) {
      throw new WsException({
        code: "INVALID_PAYLOAD",
        message: "timer.command requires a start, pause, or reset action",
      });
    }

    return result.data;
  }
}
