import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.ts";

export function createDatabase(client: Pool) {
  return drizzle({ client, schema });
}

export type Database = ReturnType<typeof createDatabase>;

export interface DatabaseConnection {
  database: Database;
  close(): Promise<void>;
}

export function createDatabaseConnection(
  connectionString: string,
): DatabaseConnection {
  const client = new Pool({ connectionString });

  return {
    database: createDatabase(client),
    close: () => client.end(),
  };
}
