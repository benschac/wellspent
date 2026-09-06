import { describe, expect, it } from "bun:test";
import {
  GOOGLE_CALENDAR_SCOPE,
  type GoogleCalendarConfig,
} from "../src/google-calendar/google-calendar.config.js";
import { GoogleCalendarHttpClient } from "../src/google-calendar/google-calendar.http-client.js";

describe("GoogleCalendarHttpClient", () => {
  it("builds an offline PKCE authorization URL with the narrow app scope", () => {
    const client = new GoogleCalendarHttpClient({
      clientId: "client-id",
      redirectUri:
        "https://api.example.com/api/integrations/google-calendar/callback",
    } as GoogleCalendarConfig);

    const url = new URL(
      client.buildAuthorizationUrl({
        codeChallenge: "challenge",
        state: "state",
      }),
    );

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_CALENDAR_SCOPE);
    expect(url.searchParams.get("state")).toBe("state");
  });
});
