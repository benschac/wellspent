import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GoogleCalendarConfig } from "./google-calendar.config.js";
import { GoogleCalendarRepository } from "./google-calendar.repository.js";
import { GoogleCalendarService } from "./google-calendar.service.js";

@Injectable()
export class GoogleCalendarJobRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleCalendarJobRunner.name);
  private readonly workerId = randomUUID();
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private nextRenewalCheckAt = 0;

  constructor(
    private readonly config: GoogleCalendarConfig,
    private readonly repository: GoogleCalendarRepository,
    private readonly service: GoogleCalendarService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) {
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
    if (this.stopping) {
      return;
    }

    try {
      if (Date.now() >= this.nextRenewalCheckAt) {
        await this.repository.enqueueDueRenewals();
        this.nextRenewalCheckAt = Date.now() + 60 * 60 * 1000;
      }
      for (let processed = 0; processed < 10; processed += 1) {
        const job = await this.repository.claimNextJob(this.workerId);
        if (job === undefined) {
          break;
        }

        try {
          if (job.connectionId === null) {
            throw new Error(`Unsupported Google Calendar job: ${job.jobType}`);
          }
          switch (job.jobType) {
            case "pull_changes":
              await this.service.pullChanges(job.connectionId);
              break;
            case "renew_watch":
              await this.service.renewWatch(job.connectionId);
              break;
            default:
              throw new Error(
                `Unsupported Google Calendar job: ${job.jobType}`,
              );
          }
          await this.repository.completeJob(job.id, this.workerId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown job failure";
          this.logger.error(`Google Calendar job ${job.id} failed: ${message}`);
          await this.repository.failJob(job.id, this.workerId, message);
        }
      }
    } catch (error) {
      this.logger.error(
        `Google Calendar worker failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      if (!this.stopping) {
        this.schedule(1000);
      }
    }
  }
}
