import { Injectable, type PipeTransform } from "@nestjs/common";
import { WsException } from "@nestjs/websockets";
import {
  type RealtimeTimerLiveActivityRegistration,
  realtimeTimerLiveActivityRegistrationSchema,
} from "@repo/api-contract";

@Injectable()
export class RealtimeLiveActivityRegistrationPipe
  implements PipeTransform<unknown, RealtimeTimerLiveActivityRegistration>
{
  transform(value: unknown): RealtimeTimerLiveActivityRegistration {
    const result = realtimeTimerLiveActivityRegistrationSchema.safeParse(value);

    if (!result.success) {
      throw new WsException({
        code: "INVALID_PAYLOAD",
        message:
          "timer.live_activity.register requires an activity ID, push token, and WebSocket URL",
      });
    }

    return result.data;
  }
}
