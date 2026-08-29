import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  out: "../../supabase/migrations",
  schema: "./src/schema/index.ts",
  strict: true,
  verbose: true,
  ...(databaseUrl === undefined
    ? {}
    : {
        dbCredentials: {
          url: databaseUrl,
        },
      }),
});
