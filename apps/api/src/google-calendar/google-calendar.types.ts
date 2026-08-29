export interface GoogleOAuthTokens {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken?: string;
  scopes: string[];
}

export interface GoogleNotificationChannel {
  channelId: string;
  resourceId: string;
  expiration: Date;
}

export interface GoogleCalendarEvent {
  id: string;
  etag?: string;
  status?: string;
  updated?: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

export interface GoogleCalendarEventPage {
  events: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface CreateWatchInput {
  accessToken: string;
  address: string;
  calendarId: string;
  channelId: string;
  channelToken: string;
}

export interface ListEventsInput {
  accessToken: string;
  calendarId: string;
  pageToken?: string;
  syncToken?: string;
}

export abstract class GoogleCalendarClient {
  abstract buildAuthorizationUrl(input: {
    codeChallenge: string;
    state: string;
  }): string;

  abstract exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<GoogleOAuthTokens>;

  abstract refreshAccessToken(refreshToken: string): Promise<string>;

  abstract createCalendar(accessToken: string): Promise<string>;

  abstract createWatch(input: CreateWatchInput): Promise<GoogleNotificationChannel>;

  abstract listEvents(input: ListEventsInput): Promise<GoogleCalendarEventPage>;

  abstract stopWatch(input: {
    accessToken: string;
    channelId: string;
    resourceId: string;
  }): Promise<void>;

  abstract revokeToken(token: string): Promise<void>;
}

export class GoogleCalendarApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleCalendarApiError";
  }
}
