import { Injectable, type PipeTransform } from "@nestjs/common";
import { WsException } from "@nestjs/websockets";
import { type RealtimePing, realtimePingSchema } from "@repo/api-contract";

@Injectable()
export class RealtimePingPipe implements PipeTransform<unknown, RealtimePing> {
  transform(value: unknown): RealtimePing {
    const result = realtimePingSchema.safeParse(value);

    if (!result.success) {
      throw new WsException({
        code: "INVALID_PAYLOAD",
        message: "realtime.ping requires an ISO 8601 sentAt value",
      });
    }

    return result.data;
  }
}
