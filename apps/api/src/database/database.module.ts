import {
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import {
  createDatabaseConnection,
  type Database,
  type DatabaseConnection,
} from "@repo/database";
import type { Environment } from "../config/environment.js";
import { DATABASE } from "./database.constants.js";

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  readonly database: Database;
  private readonly connection: DatabaseConnection;

  constructor(config: ConfigService<Environment, true>) {
    this.connection = createDatabaseConnection(
      config.get("DATABASE_URL", { infer: true }),
    );
    this.database = this.connection.database;
  }

  onApplicationShutdown(): Promise<void> {
    return this.connection.close();
  }
}

@Module({
  imports: [ConfigModule],
  providers: [
    DatabaseLifecycle,
    {
      provide: DATABASE,
      inject: [DatabaseLifecycle],
      useFactory: (lifecycle: DatabaseLifecycle): Database =>
        lifecycle.database,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
