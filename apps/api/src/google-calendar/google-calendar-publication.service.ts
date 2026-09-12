import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { GoogleOAuthService } from "../google/google-oauth.service.js";
import { GoogleCalendarConfig } from "./google-calendar.config.js";
import { GoogleCalendarRepository } from "./google-calendar.repository.js";
import { GoogleCalendarClient } from "./google-calendar.types.js";
import { GoogleCalendarJobDispatcher } from "./google-calendar-job-dispatcher.js";
import {
  calendarPublicationPayload,
  calendarPublicationSelection,
  createCalendarPublication,
} from "./google-calendar-publication.js";

@Injectable()
export class GoogleCalendarPublicationService {
  constructor(
    @Inject(GoogleCalendarConfig) private readonly config: GoogleCalendarConfig,
    @Inject(GoogleCalendarRepository)
    private readonly repository: GoogleCalendarRepository,
    @Inject(GoogleCalendarJobDispatcher)
    private readonly dispatcher: GoogleCalendarJobDispatcher,
    @Inject(GoogleOAuthService) private readonly oauth: GoogleOAuthService,
    @Inject(GoogleCalendarClient) private readonly client: GoogleCalendarClient,
  ) {}

  async publish(userId: string, input: unknown) {
    this.config.assertEnabled();
    const parsed = calendarPublicationSelection.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(
        "Provide between 1 and 500 unique session UUIDs",
      );
    const connection = await this.repository.findConnectionByUserId(userId);
    const authorization = await this.oauth.status(userId, "calendar");
    if (
      !connection?.calendarId ||
      !authorization.authorized ||
      connection.status !== "connected"
    ) {
      throw new UnauthorizedException(
        "Connect Google Calendar to publish sessions",
      );
    }
    const sessions = await this.repository.findCompletedPublicationSessions(
      userId,
      parsed.data.sessionIds,
    );
    if (sessions.length !== parsed.data.sessionIds.length)
      throw new NotFoundException("One or more sessions were not found");
    const publications = sessions.map((session) =>
      createCalendarPublication(connection.id, session),
    );
    if (Buffer.byteLength(JSON.stringify(publications), "utf8") > 1_000_000) {
      throw new BadRequestException(
        "Publication is too large; select fewer sessions",
      );
    }
    await this.repository.enqueuePublications(connection.id, publications);
    await this.dispatcher.dispatch(publications.length);
    return { queuedSessionCount: publications.length };
  }

  async status(userId: string) {
    if (!this.config.enabled) return { publications: [] };
    const jobs = await this.repository.listPublications(userId);
    return {
      publications: jobs.map((job) => ({
        sessionId: calendarPublicationPayload.parse(job.payload).sessionId,
        status: job.status,
        lastError: job.lastError
          ? "Calendar publishing failed. Reconnect if needed and try publishing again."
          : null,
      })),
    };
  }

  async run(connectionId: string, payload: Record<string, unknown>) {
    const publication = calendarPublicationPayload.parse(payload);
    const connection = await this.repository.findConnectionById(connectionId);
    // Disconnect cancels queued work through the connection foreign key.
    if (!connection?.calendarId) return;
    let accessToken: string;
    try {
      accessToken = await this.oauth.getAccessToken(
        connection.userId,
        "calendar",
      );
    } catch (error) {
      if (error instanceof UnauthorizedException)
        await this.repository.markReconnectRequired(connectionId);
      throw error;
    }
    await this.client.publishEvent({
      accessToken,
      calendarId: connection.calendarId,
      event: publication.event,
    });
    await this.repository.recordPublication(
      connection.id,
      connection.calendarId,
      publication,
    );
  }
}
