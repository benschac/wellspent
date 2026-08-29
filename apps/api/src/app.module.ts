import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ORPCModule } from "@orpc/nest";
import { onError } from "@orpc/server";
import { validateEnvironment } from "./config/environment.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";

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
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
