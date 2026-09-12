import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import {
  WorkLogController,
  WorkLogTokensController,
} from "./work-log.controller.js";
import { WorkLogRepository } from "./work-log.repository.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [WorkLogController, WorkLogTokensController],
  providers: [WorkLogRepository],
})
export class WorkLogModule {}
