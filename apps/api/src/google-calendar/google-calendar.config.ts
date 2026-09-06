import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../config/environment.js";

export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.app.created";

@Injectable()
export class GoogleCalendarConfig {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  get enabled(): boolean {
    return this.config.get("GOOGLE_CALENDAR_ENABLED", { infer: true });
  }

  assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        "Google Calendar integration is disabled",
      );
    }
  }

  get clientId(): string {
    return this.required("GOOGLE_OAUTH_CLIENT_ID");
  }

  get clientSecret(): string {
    return this.required("GOOGLE_OAUTH_CLIENT_SECRET");
  }

  get redirectUri(): string {
    return this.required("GOOGLE_OAUTH_REDIRECT_URI");
  }

  get webhookUrl(): string {
    return this.required("GOOGLE_CALENDAR_WEBHOOK_URL");
  }

  get encryptionKey(): Buffer {
    return Buffer.from(
      this.required("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"),
      "base64",
    );
  }

  private required(
    key:
      | "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"
      | "GOOGLE_CALENDAR_WEBHOOK_URL"
      | "GOOGLE_OAUTH_CLIENT_ID"
      | "GOOGLE_OAUTH_CLIENT_SECRET"
      | "GOOGLE_OAUTH_REDIRECT_URI",
  ): string {
    this.assertEnabled();
    const value = this.config.get(key, { infer: true });
    if (value === undefined) {
      throw new ServiceUnavailableException(`${key} is not configured`);
    }
    return value;
  }
}
