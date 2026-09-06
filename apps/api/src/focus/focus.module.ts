import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { FocusCaptureController, FocusController } from "./focus.controller.js";
import { FocusRepository } from "./focus.repository.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [FocusController, FocusCaptureController],
  providers: [FocusRepository],
})
export class FocusModule {}
