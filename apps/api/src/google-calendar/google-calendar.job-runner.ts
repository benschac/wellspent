import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { GoogleCalendarConfig } from "./google-calendar.config.js";
import { GoogleCalendarRepository } from "./google-calendar.repository.js";
import { GoogleCalendarService } from "./google-calendar.service.js";
import { GoogleCalendarPublicationService } from "./google-calendar-publication.service.js";

@Injectable()
export class GoogleCalendarJobRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleCalendarJobRunner.name);
  private readonly workerId = randomUUID();
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private nextRenewalCheckAt = 0;

  constructor(
    @Inject(GoogleCalendarConfig) private readonly config: GoogleCalendarConfig,
    @Inject(GoogleCalendarRepository)
    private readonly repository: GoogleCalendarRepository,
    @Inject(GoogleCalendarService)
    private readonly service: GoogleCalendarService,
    @Inject(GoogleCalendarPublicationService)
    private readonly publications: GoogleCalendarPublicationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled || this.config.serverless) {
      return;
    }
    await this.repository.recoverStaleJobs();
    this.schedule(0);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.stopping) return;
    try {
      await this.runBatch();
    } catch {
      this.logger.error("Google Calendar worker batch failed");
    } finally {
      if (!this.stopping) this.schedule(1000);
    }
  }

  // Awaited by the scheduler request on serverless hosts. Database claims make
  // overlapping cron and queue invocations safe.
  async runBatch(): Promise<{ processed: number }> {
    if (!this.config.enabled) return { processed: 0 };
    let processed = 0;
    const startedAt = performance.now();
    await this.repository.recoverStaleJobs();
    if (Date.now() >= this.nextRenewalCheckAt) {
      await this.repository.enqueueDueRenewals();
      this.nextRenewalCheckAt = Date.now() + 60 * 60 * 1000;
    }
    while (processed < 10 && performance.now() - startedAt < 20_000) {
      const job = await this.repository.claimNextJob(this.workerId);
      if (!job) break;
      processed += 1;
      try {
        if (!job.connectionId) throw new Error("Missing Calendar connection");
        switch (job.jobType) {
          case "publish_session":
            await this.publications.run(job.connectionId, job.payload);
            break;
          case "pull_changes":
            await this.service.pullChanges(job.connectionId);
            break;
          case "renew_watch":
            await this.service.renewWatch(job.connectionId);
            break;
          default:
            throw new Error("Unsupported Google Calendar job");
        }
        await this.repository.completeJob(job.id, this.workerId);
      } catch {
        // Provider bodies, account data, and credentials never enter job status.
        const message =
          "Google Calendar job failed; reconnect if needed and retry";
        this.logger.error(`Google Calendar job ${job.id} failed`);
        await this.repository.failJob(job.id, this.workerId, message);
      }
    }
    return { processed };
  }
}
