import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  UnauthorizedException,
} from "@nestjs/common";
import { CryptoService } from "../crypto/crypto.service.js";
import { GoogleCalendarConfig } from "./google-calendar.config.js";
import { GoogleCalendarJobRunner } from "./google-calendar.job-runner.js";

@Controller("integrations/google-calendar/jobs")
export class GoogleCalendarJobsController {
  constructor(
    @Inject(GoogleCalendarConfig) private readonly config: GoogleCalendarConfig,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(GoogleCalendarJobRunner)
    private readonly runner: GoogleCalendarJobRunner,
  ) {}

  @Get("run")
  @Header("Cache-Control", "no-store")
  run(@Headers("authorization") authorization?: string) {
    const secret = this.config.cronSecret;
    if (
      !secret ||
      !authorization ||
      !this.crypto.matchesSha256(
        authorization,
        this.crypto.sha256(`Bearer ${secret}`),
      )
    ) {
      throw new UnauthorizedException("Invalid scheduler authorization");
    }
    return this.runner.runBatch();
  }
}
