import { Injectable } from "@nestjs/common";
import type { HealthOutput } from "@repo/api-contract";

@Injectable()
export class HealthService {
  check(): HealthOutput {
    return {
      service: "api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
