import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CryptoModule } from "../crypto/crypto.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { GoogleCalendarConfig } from "./google-calendar.config.js";
import { GoogleCalendarController } from "./google-calendar.controller.js";
import { GoogleCalendarHttpClient } from "./google-calendar.http-client.js";
import { GoogleCalendarJobRunner } from "./google-calendar.job-runner.js";
import { GoogleCalendarRepository } from "./google-calendar.repository.js";
import { GoogleCalendarService } from "./google-calendar.service.js";
import { GoogleCalendarClient } from "./google-calendar.types.js";

@Module({
  imports: [AuthModule, CryptoModule, DatabaseModule],
  controllers: [GoogleCalendarController],
  providers: [
    GoogleCalendarConfig,
    GoogleCalendarJobRunner,
    GoogleCalendarRepository,
    GoogleCalendarService,
    {
      provide: GoogleCalendarClient,
      useClass: GoogleCalendarHttpClient,
    },
  ],
})
export class GoogleCalendarModule {}
