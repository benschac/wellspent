import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { apiContract } from "@repo/api-contract";
import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Implement(apiContract.health)
  health() {
    return implement(apiContract.health).handler(() =>
      this.healthService.check(),
    );
  }
}
