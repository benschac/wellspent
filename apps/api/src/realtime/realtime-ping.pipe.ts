import { Injectable, type PipeTransform } from "@nestjs/common";
import { realtimePingSchema, type RealtimePing } from "@repo/api-contract";
import { WsException } from "@nestjs/websockets";

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
