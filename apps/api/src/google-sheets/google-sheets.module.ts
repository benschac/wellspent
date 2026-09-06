import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { GoogleModule } from "../google/google.module.js";
import { GoogleSheetsClient } from "./google-sheets.client.js";
import { GoogleSheetsController } from "./google-sheets.controller.js";
import { GoogleSheetsRepository } from "./google-sheets.repository.js";
import { GoogleSheetsService } from "./google-sheets.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, GoogleModule],
  controllers: [GoogleSheetsController],
  providers: [GoogleSheetsClient, GoogleSheetsRepository, GoogleSheetsService],
})
export class GoogleSheetsModule {}
