import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarConfig,
} from "./google-calendar.config.js";
import {
  GoogleCalendarApiError,
  GoogleCalendarClient,
  type CreateWatchInput,
  type GoogleCalendarEventPage,
  type GoogleNotificationChannel,
  type GoogleOAuthTokens,
  type ListEventsInput,
} from "./google-calendar.types.js";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(GOOGLE_CALENDAR_SCOPE),
});

const calendarSchema = z.object({ id: z.string().min(1) });

const watchSchema = z.object({
  id: z.string().min(1),
  resourceId: z.string().min(1),
  expiration: z.coerce.number().int().positive(),
});

const eventDateSchema = z
  .object({
    date: z.string().optional(),
    dateTime: z.string().optional(),
    timeZone: z.string().optional(),
  })
  .passthrough();

const eventSchema = z
  .object({
    id: z.string().min(1),
    etag: z.string().optional(),
    status: z.string().optional(),
    updated: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    start: eventDateSchema.optional(),
    end: eventDateSchema.optional(),
    extendedProperties: z
      .object({
        private: z.record(z.string(), z.string()).optional(),
        shared: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();

const eventPageSchema = z.object({
  items: z.array(eventSchema).default([]),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
});

@Injectable()
export class GoogleCalendarHttpClient extends GoogleCalendarClient {
  constructor(private readonly config: GoogleCalendarConfig) {
    super();
  }

  buildAuthorizationUrl(input: {
    codeChallenge: string;
    state: string;
  }): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      access_type: "offline",
      client_id: this.config.clientId,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      include_granted_scopes: "true",
      prompt: "consent",
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: GOOGLE_CALENDAR_SCOPE,
      state: input.state,
    }).toString();
    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<GoogleOAuthTokens> {
    const response = await this.formRequest("https://oauth2.googleapis.com/token", {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: this.config.redirectUri,
    });
    return this.parseTokens(response);
  }

  async refreshAccessToken(refreshToken: string): Promise<string> {
    const response = await this.formRequest("https://oauth2.googleapis.com/token", {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return this.parseTokens(response).accessToken;
  }

  async createCalendar(accessToken: string): Promise<string> {
    const response = await this.jsonRequest(
      "https://www.googleapis.com/calendar/v3/calendars",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          summary: "Focus Timer",
          description: "Focus sessions synchronized by the Timer app.",
        }),
      },
    );
    return calendarSchema.parse(response).id;
  }

  async createWatch(input: CreateWatchInput): Promise<GoogleNotificationChannel> {
    const calendarId = encodeURIComponent(input.calendarId);
    const response = await this.jsonRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/watch`,
      input.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          id: input.channelId,
          type: "web_hook",
          address: input.address,
          token: input.channelToken,
          params: { ttl: "604800" },
        }),
      },
    );
    const channel = watchSchema.parse(response);
    return {
      channelId: channel.id,
      resourceId: channel.resourceId,
      expiration: new Date(channel.expiration),
    };
  }

  async listEvents(input: ListEventsInput): Promise<GoogleCalendarEventPage> {
    const calendarId = encodeURIComponent(input.calendarId);
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
    );
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("showDeleted", "true");
    if (input.pageToken !== undefined) {
      url.searchParams.set("pageToken", input.pageToken);
    }
    if (input.syncToken !== undefined) {
      url.searchParams.set("syncToken", input.syncToken);
    }

    const parsed = eventPageSchema.parse(
      await this.jsonRequest(url.toString(), input.accessToken),
    );
    return {
      events: parsed.items as unknown as GoogleCalendarEventPage["events"],
      ...(parsed.nextPageToken === undefined
        ? {}
        : { nextPageToken: parsed.nextPageToken }),
      ...(parsed.nextSyncToken === undefined
        ? {}
        : { nextSyncToken: parsed.nextSyncToken }),
    };
  }

  async stopWatch(input: {
    accessToken: string;
    channelId: string;
    resourceId: string;
  }): Promise<void> {
    await this.jsonRequest(
      "https://www.googleapis.com/calendar/v3/channels/stop",
      input.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          id: input.channelId,
          resourceId: input.resourceId,
        }),
      },
      true,
    );
  }

  async revokeToken(token: string): Promise<void> {
    const response = await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new GoogleCalendarApiError("Google token revocation failed", response.status);
    }
  }

  private parseTokens(value: unknown): GoogleOAuthTokens {
    const parsed = tokenResponseSchema.parse(value);
    return {
      accessToken: parsed.access_token,
      expiresInSeconds: parsed.expires_in,
      scopes: parsed.scope.split(" ").filter(Boolean),
      ...(parsed.refresh_token === undefined
        ? {}
        : { refreshToken: parsed.refresh_token }),
    };
  }

  private async formRequest(
    url: string,
    body: Record<string, string>,
  ): Promise<unknown> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(10_000),
    });
    return this.readJson(response);
  }

  private async jsonRequest(
    url: string,
    accessToken: string,
    init: RequestInit = {},
    allowEmpty = false,
  ): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (allowEmpty && response.ok) {
      return undefined;
    }
    return this.readJson(response);
  }

  private async readJson(response: Response): Promise<unknown> {
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new GoogleCalendarApiError(
        `Google Calendar request failed with ${response.status}`,
        response.status,
      );
    }
    return value;
  }
}
