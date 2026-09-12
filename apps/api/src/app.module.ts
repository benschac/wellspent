import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ORPCModule } from "@orpc/nest";
import { onError } from "@orpc/server";
import { AssistantModule } from "./assistant/assistant.module.js";
import { validateEnvironment } from "./config/environment.js";
import { DatabaseModule } from "./database/database.module.js";
import { ApplicationEventBusModule } from "./events/application-event-bus.module.js";
import { FocusModule } from "./focus/focus.module.js";
import { GoogleCalendarModule } from "./google-calendar/google-calendar.module.js";
import { GoogleSheetsModule } from "./google-sheets/google-sheets.module.js";
import { HealthModule } from "./health/health.module.js";
import { ProfileModule } from "./profile/profile.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { WorkLogModule } from "./work-log/work-log.module.js";

const orpcLogger = new Logger("oRPC");

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ORPCModule.forRoot({
      interceptors: [
        onError((error) => {
          orpcLogger.error(error);
        }),
      ],
    }),
    ApplicationEventBusModule,
    AssistantModule,
    DatabaseModule,
    GoogleCalendarModule,
    GoogleSheetsModule,
    HealthModule,
    ProfileModule,
    RealtimeModule,
    FocusModule,
    WorkLogModule,
  ],
})
export class AppModule {}
