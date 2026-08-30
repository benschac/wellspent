import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../config/environment.js";

type RequiredAppleConfigKey =
  | "APPLE_APNS_BUNDLE_ID"
  | "APPLE_APNS_KEY_ID"
  | "APPLE_APNS_PRIVATE_KEY_BASE64"
  | "APPLE_APNS_TEAM_ID";

@Injectable()
export class LiveActivityPushConfig {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  get enabled(): boolean {
    return this.config.get("APPLE_LIVE_ACTIVITY_PUSH_ENABLED", { infer: true });
  }

  get apnsOrigin(): string {
    const environment = this.config.get("APPLE_APNS_ENVIRONMENT", {
      infer: true,
    });

    return environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  }

  get bundleId(): string {
    return this.required("APPLE_APNS_BUNDLE_ID");
  }

  get keyId(): string {
    return this.required("APPLE_APNS_KEY_ID");
  }

  get privateKey(): string {
    return Buffer.from(
      this.required("APPLE_APNS_PRIVATE_KEY_BASE64"),
      "base64",
    ).toString("utf8");
  }

  get teamId(): string {
    return this.required("APPLE_APNS_TEAM_ID");
  }

  private required(key: RequiredAppleConfigKey): string {
    if (!this.enabled) {
      throw new ServiceUnavailableException("Live Activity push is disabled");
    }

    const value = this.config.get(key, { infer: true });
    if (value === undefined) {
      throw new ServiceUnavailableException(`${key} is not configured`);
    }
    return value;
  }
}
