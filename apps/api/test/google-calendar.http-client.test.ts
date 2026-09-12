import { describe, expect, it } from "bun:test";
import {
  GOOGLE_CALENDAR_SCOPE,
  type GoogleCalendarConfig,
} from "../src/google-calendar/google-calendar.config.js";
import { GoogleCalendarHttpClient } from "../src/google-calendar/google-calendar.http-client.js";
import { createCalendarPublication } from "../src/google-calendar/google-calendar-publication.js";

describe("GoogleCalendarHttpClient", () => {
  it("retries an ambiguous insert using the same ID and verifies a duplicate without overwriting edits", async () => {
    const originalFetch = globalThis.fetch;
    const event = createCalendarPublication("connection", {
      id: "10000000-0000-4000-8000-000000000001",
      revision: 1,
      status: "completed",
      intention: "Work",
      recapText: null,
      elapsedMs: 60000,
      createdAt: new Date("2026-09-07T10:00:00Z"),
      completedAt: new Date("2026-09-07T10:01:00Z"),
    }).event;
    const methods: string[] = [];
    let calls = 0;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      methods.push(init?.method ?? "GET");
      calls += 1;
      if (calls === 1) throw new Error("response lost");
      if (calls === 2) return Response.json({}, { status: 409 });
      return Response.json({ ...event, summary: "Edited in Google" });
    }) as typeof fetch;
    try {
      const client = new GoogleCalendarHttpClient({} as GoogleCalendarConfig);
      await expect(
        client.publishEvent({
          accessToken: "test",
          calendarId: "calendar",
          event,
        }),
      ).rejects.toThrow("response lost");
      await client.publishEvent({
        accessToken: "test",
        calendarId: "calendar",
        event,
      });
      expect(methods).toEqual(["POST", "POST", "GET"]);
      globalThis.fetch = (async (
        _url: string | URL | Request,
        init?: RequestInit,
      ) =>
        init?.method === "POST"
          ? Response.json({}, { status: 409 })
          : Response.json({
              id: event.id,
              status: "cancelled",
            })) as typeof fetch;
      await expect(
        client.publishEvent({
          accessToken: "test",
          calendarId: "calendar",
          event,
        }),
      ).rejects.toThrow("identity conflict");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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
