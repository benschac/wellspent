import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../config/environment.js";

export type GoogleIntegration = "calendar" | "sheets";
export const GOOGLE_SCOPES = {
  calendar: "https://www.googleapis.com/auth/calendar.app.created",
  sheets: "https://www.googleapis.com/auth/drive.file",
} as const;

@Injectable()
export class GoogleConfig {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  assertEnabled(integration: GoogleIntegration): void {
    if (
      !this.config.get(
        integration === "calendar"
          ? "GOOGLE_CALENDAR_ENABLED"
          : "GOOGLE_SHEETS_ENABLED",
        { infer: true },
      )
    ) {
      throw new ServiceUnavailableException(
        `Google ${integration} integration is disabled`,
      );
    }
  }

  get clientId(): string {
    return this.required("GOOGLE_OAUTH_CLIENT_ID");
  }
  get clientSecret(): string {
    return this.required("GOOGLE_OAUTH_CLIENT_SECRET");
  }
  // Keep the existing key so Calendar ciphertext migrates without re-encryption.
  get encryptionKey(): Buffer {
    return Buffer.from(
      this.required("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"),
      "base64",
    );
  }
  redirectUri(integration: GoogleIntegration): string {
    return this.required(
      integration === "calendar"
        ? "GOOGLE_OAUTH_REDIRECT_URI"
        : "GOOGLE_SHEETS_OAUTH_REDIRECT_URI",
    );
  }
  private required(
    key:
      | "GOOGLE_OAUTH_CLIENT_ID"
      | "GOOGLE_OAUTH_CLIENT_SECRET"
      | "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"
      | "GOOGLE_OAUTH_REDIRECT_URI"
      | "GOOGLE_SHEETS_OAUTH_REDIRECT_URI",
  ): string {
    const value = this.config.get(key, { infer: true });
    if (!value)
      throw new ServiceUnavailableException(`${key} is not configured`);
    return value;
  }
}
