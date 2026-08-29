import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

const server = {
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000,http://localhost:8081"),
  DATABASE_URL: z.url(),
  GOOGLE_CALENDAR_ENABLED: z.stringbool().default(false),
  GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CALENDAR_WEBHOOK_URL: z.url().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_URL: z.url().optional(),
};

export interface Environment {
  CORS_ORIGIN: string;
  DATABASE_URL: string;
  GOOGLE_CALENDAR_ENABLED: boolean;
  GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY?: string | undefined;
  GOOGLE_CALENDAR_WEBHOOK_URL?: string | undefined;
  GOOGLE_OAUTH_CLIENT_ID?: string | undefined;
  GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined;
  GOOGLE_OAUTH_REDIRECT_URI?: string | undefined;
  PORT: number;
  SUPABASE_PUBLISHABLE_KEY?: string | undefined;
  SUPABASE_URL?: string | undefined;
}

export function validateEnvironment(
  environment: Record<string, string | number | boolean | undefined>,
): Environment {
  const validated = createEnv({
    server,
    runtimeEnv: environment,
    emptyStringAsUndefined: true,
  });

  if (validated.GOOGLE_CALENDAR_ENABLED) {
    const requiredKeys = [
      "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY",
      "GOOGLE_CALENDAR_WEBHOOK_URL",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_REDIRECT_URI",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_URL",
    ] as const;

    for (const key of requiredKeys) {
      if (validated[key] === undefined) {
        throw new Error(`${key} is required when Google Calendar is enabled`);
      }
    }

    const encryptionKey = Buffer.from(
      validated.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY ?? "",
      "base64",
    );
    if (encryptionKey.length !== 32) {
      throw new Error(
        "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      );
    }

    if (!validated.GOOGLE_CALENDAR_WEBHOOK_URL?.startsWith("https://")) {
      throw new Error("GOOGLE_CALENDAR_WEBHOOK_URL must use HTTPS");
    }
  }

  return validated;
}
