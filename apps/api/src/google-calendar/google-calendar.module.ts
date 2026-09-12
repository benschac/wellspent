import { Module } from "@nestjs/common";
import { send } from "@vercel/queue";
import { AuthModule } from "../auth/auth.module.js";
import { CryptoModule } from "../crypto/crypto.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { GoogleModule } from "../google/google.module.js";
import { GoogleCalendarConfig } from "./google-calendar.config.js";
import { GoogleCalendarController } from "./google-calendar.controller.js";
import { GoogleCalendarHttpClient } from "./google-calendar.http-client.js";
import { GoogleCalendarJobRunner } from "./google-calendar.job-runner.js";
import { GoogleCalendarRepository } from "./google-calendar.repository.js";
import { GoogleCalendarService } from "./google-calendar.service.js";
import { GoogleCalendarClient } from "./google-calendar.types.js";
import {
  GOOGLE_CALENDAR_QUEUE_SEND,
  GoogleCalendarJobDispatcher,
} from "./google-calendar-job-dispatcher.js";
import { GoogleCalendarJobsController } from "./google-calendar-jobs.controller.js";
import { GoogleCalendarPublicationController } from "./google-calendar-publication.controller.js";
import { GoogleCalendarPublicationService } from "./google-calendar-publication.service.js";

@Module({
  imports: [AuthModule, CryptoModule, DatabaseModule, GoogleModule],
  controllers: [
    GoogleCalendarController,
    GoogleCalendarPublicationController,
    GoogleCalendarJobsController,
  ],
  providers: [
    GoogleCalendarConfig,
    GoogleCalendarJobDispatcher,
    GoogleCalendarJobRunner,
    GoogleCalendarRepository,
    GoogleCalendarService,
    GoogleCalendarPublicationService,
    {
      provide: GOOGLE_CALENDAR_QUEUE_SEND,
      useValue: send,
    },
    {
      provide: GoogleCalendarClient,
      useClass: GoogleCalendarHttpClient,
    },
  ],
})
export class GoogleCalendarModule {}
