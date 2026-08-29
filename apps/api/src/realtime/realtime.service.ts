import { Injectable } from "@nestjs/common";
import type { RealtimePing, RealtimePong } from "@repo/api-contract";

@Injectable()
export class RealtimeService {
  createPong(ping: RealtimePing): RealtimePong {
    return {
      sentAt: ping.sentAt,
      serverTime: new Date().toISOString(),
    };
  }
}
