import { describe, expect, it } from "bun:test";
import { ConfigService } from "@nestjs/config";
import {
  type Environment,
  validateEnvironment,
} from "../src/config/environment.js";
import { GoogleConfig } from "../src/google/google.config.js";

const baseEnvironment = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54422/postgres",
};

describe("Google integration configuration", () => {
  it("allows JSON callbacks when the return URL is unset or empty", () => {
    for (const value of [undefined, ""]) {
      const env = validateEnvironment({
        ...baseEnvironment,
        GOOGLE_INTEGRATIONS_RETURN_URL: value,
      });
      const config = new GoogleConfig(
        new ConfigService<Environment, true>(env),
      );
      expect(config.returnUrl).toBeUndefined();
      expect(config.enabled("calendar")).toBe(false);
      expect(config.enabled("sheets")).toBe(false);
      expect(() => config.assertEnabled("calendar")).toThrow("disabled");
    }
  });

  it("supports HTTPS and explicit HTTP loopback return destinations", () => {
    for (const value of [
      "https://wellspent.day/focus",
      "http://localhost:3000/focus",
      "http://127.0.0.1:3000/focus",
      "http://[::1]:3000/focus",
    ]) {
      const env = validateEnvironment({
        ...baseEnvironment,
        GOOGLE_INTEGRATIONS_RETURN_URL: value,
      });
      expect(env.GOOGLE_INTEGRATIONS_RETURN_URL).toBe(value);
    }
  });

  it("rejects non-web, insecure remote, credential-bearing, and relative return destinations", () => {
    for (const value of [
      "javascript:alert(1)",
      "/focus",
      "http://wellspent.day/focus",
      "http://localhost.evil.example/focus",
      "https://user:secret@wellspent.day/focus",
    ]) {
      expect(() =>
        validateEnvironment({
          ...baseEnvironment,
          GOOGLE_INTEGRATIONS_RETURN_URL: value,
        }),
      ).toThrow();
    }
  });

  it("reports each integration flag independently after full enabled validation", () => {
    const env = validateEnvironment({
      ...baseEnvironment,
      GOOGLE_SHEETS_ENABLED: "true",
      GOOGLE_OAUTH_CLIENT_ID: "client",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      GOOGLE_SHEETS_OAUTH_REDIRECT_URI:
        "http://localhost:3001/api/integrations/google-sheets/callback",
      GOOGLE_INTEGRATIONS_RETURN_URL: "http://localhost:3000/focus",
      SUPABASE_URL: "http://127.0.0.1:54421",
      SUPABASE_PUBLISHABLE_KEY: "test-key",
    });
    const config = new GoogleConfig(new ConfigService<Environment, true>(env));
    expect(config.enabled("calendar")).toBe(false);
    expect(config.enabled("sheets")).toBe(true);
    expect(() => config.assertEnabled("sheets")).not.toThrow();
    expect(config.returnUrl).toBe("http://localhost:3000/focus");
  });
});
