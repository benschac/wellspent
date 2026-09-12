import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

const server = {
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default("openai/gpt-5.6-luna"),
  APPLE_APNS_BUNDLE_ID: z.string().min(1).optional(),
  APPLE_APNS_ENVIRONMENT: z
    .enum(["development", "production"])
    .default("development"),
  APPLE_APNS_KEY_ID: z.string().min(1).optional(),
  APPLE_APNS_PRIVATE_KEY_BASE64: z.string().min(1).optional(),
  APPLE_APNS_TEAM_ID: z.string().min(1).optional(),
  APPLE_LIVE_ACTIVITY_PUSH_ENABLED: z.stringbool().default(false),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000,http://localhost:8081"),
  CRON_SECRET: z.string().min(16).optional(),
  DATABASE_URL: z.url(),
  FOCUS_REALTIME_ENABLED: z.stringbool().default(false),
  GOOGLE_CALENDAR_ENABLED: z.stringbool().default(false),
  GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CALENDAR_WEBHOOK_URL: z.url().optional(),
  GOOGLE_INTEGRATIONS_RETURN_URL: z
    .url({ protocol: /^https?$/ })
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        (url.protocol === "https:" ||
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      );
    }, "Google return URL must use HTTPS or HTTP loopback without credentials")
    .optional(),
  GOOGLE_SHEETS_ENABLED: z.stringbool().default(false),
  GOOGLE_SHEETS_OAUTH_REDIRECT_URI: z.url().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_URL: z.url().optional(),
  VERCEL: z.string().optional(),
};

export interface Environment {
  AI_GATEWAY_API_KEY?: string | undefined;
  AI_MODEL: string;
  APPLE_APNS_BUNDLE_ID?: string | undefined;
  APPLE_APNS_ENVIRONMENT: "development" | "production";
  APPLE_APNS_KEY_ID?: string | undefined;
  APPLE_APNS_PRIVATE_KEY_BASE64?: string | undefined;
  APPLE_APNS_TEAM_ID?: string | undefined;
  APPLE_LIVE_ACTIVITY_PUSH_ENABLED: boolean;
  CORS_ORIGIN: string;
  CRON_SECRET?: string | undefined;
  DATABASE_URL: string;
  FOCUS_REALTIME_ENABLED?: boolean | undefined;
  GOOGLE_CALENDAR_ENABLED: boolean;
  GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY?: string | undefined;
  GOOGLE_CALENDAR_WEBHOOK_URL?: string | undefined;
  GOOGLE_INTEGRATIONS_RETURN_URL?: string | undefined;
  GOOGLE_SHEETS_ENABLED: boolean;
  GOOGLE_SHEETS_OAUTH_REDIRECT_URI?: string | undefined;
  GOOGLE_OAUTH_CLIENT_ID?: string | undefined;
  GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined;
  GOOGLE_OAUTH_REDIRECT_URI?: string | undefined;
  PORT: number;
  SUPABASE_PUBLISHABLE_KEY?: string | undefined;
  SUPABASE_SECRET_KEY?: string | undefined;
  SUPABASE_URL?: string | undefined;
  VERCEL?: string | undefined;
}

export function validateEnvironment(
  environment: Record<string, string | number | boolean | undefined>,
): Environment {
  const validated = createEnv({
    server,
    runtimeEnv: environment,
    emptyStringAsUndefined: true,
  });

  if (
    validated.FOCUS_REALTIME_ENABLED &&
    (!validated.SUPABASE_URL || !validated.SUPABASE_SECRET_KEY)
  ) {
    throw new Error(
      "SUPABASE_URL and server-only SUPABASE_SECRET_KEY are required for focus Realtime notifications",
    );
  }

  if (validated.APPLE_LIVE_ACTIVITY_PUSH_ENABLED) {
    const requiredKeys = [
      "APPLE_APNS_BUNDLE_ID",
      "APPLE_APNS_KEY_ID",
      "APPLE_APNS_PRIVATE_KEY_BASE64",
      "APPLE_APNS_TEAM_ID",
    ] as const;

    for (const key of requiredKeys) {
      if (validated[key] === undefined) {
        throw new Error(
          `${key} is required when Live Activity push is enabled`,
        );
      }
    }

    const privateKey = Buffer.from(
      validated.APPLE_APNS_PRIVATE_KEY_BASE64 ?? "",
      "base64",
    ).toString("utf8");
    if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
      throw new Error(
        "APPLE_APNS_PRIVATE_KEY_BASE64 must contain a base64-encoded APNs .p8 key",
      );
    }
  }

  if (validated.GOOGLE_CALENDAR_ENABLED || validated.GOOGLE_SHEETS_ENABLED) {
    const requiredKeys = [
      "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_URL",
    ] as const;

    for (const key of requiredKeys) {
      if (validated[key] === undefined) {
        throw new Error(
          `${key} is required when a Google integration is enabled`,
        );
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
  }

  if (
    validated.GOOGLE_SHEETS_ENABLED &&
    !validated.GOOGLE_SHEETS_OAUTH_REDIRECT_URI
  ) {
    throw new Error(
      "GOOGLE_SHEETS_OAUTH_REDIRECT_URI is required when Google Sheets is enabled",
    );
  }
  if (validated.GOOGLE_CALENDAR_ENABLED) {
    if (!validated.GOOGLE_OAUTH_REDIRECT_URI) {
      throw new Error(
        "GOOGLE_OAUTH_REDIRECT_URI is required when Google Calendar is enabled",
      );
    }
    if (!validated.GOOGLE_CALENDAR_WEBHOOK_URL?.startsWith("https://")) {
      throw new Error("GOOGLE_CALENDAR_WEBHOOK_URL must use HTTPS");
    }
  }

  return validated;
}
