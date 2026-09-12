import { Inject, Injectable, Logger } from "@nestjs/common";
import type { SendOptions } from "@vercel/queue";
import { GoogleCalendarConfig } from "./google-calendar.config.js";

export const GOOGLE_CALENDAR_JOBS_TOPIC = "google-calendar-jobs";
export const GOOGLE_CALENDAR_JOBS_PER_WAKE = 10;

export type GoogleCalendarQueueSend = (
  topic: string,
  payload: { batch: number },
  options?: SendOptions,
) => Promise<unknown>;

export const GOOGLE_CALENDAR_QUEUE_SEND = Symbol("GOOGLE_CALENDAR_QUEUE_SEND");

@Injectable()
export class GoogleCalendarJobDispatcher {
  private readonly logger = new Logger(GoogleCalendarJobDispatcher.name);

  constructor(
    @Inject(GoogleCalendarConfig) private readonly config: GoogleCalendarConfig,
    @Inject(GOOGLE_CALENDAR_QUEUE_SEND)
    private readonly send: GoogleCalendarQueueSend,
  ) {}

  async dispatch(jobCount: number): Promise<void> {
    if (!this.config.serverless || jobCount <= 0) return;

    const wakeCount = Math.ceil(jobCount / GOOGLE_CALENDAR_JOBS_PER_WAKE);
    const results = await Promise.allSettled(
      Array.from({ length: wakeCount }, (_, batch) =>
        this.send(
          GOOGLE_CALENDAR_JOBS_TOPIC,
          { batch },
          { retentionSeconds: 24 * 60 * 60 },
        ),
      ),
    );
    const failedCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    if (failedCount > 0) {
      this.logger.error(
        `${failedCount} Google Calendar queue dispatches failed; cron recovery remains active`,
      );
    }
  }
}
