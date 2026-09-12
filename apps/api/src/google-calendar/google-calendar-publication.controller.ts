import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { GoogleCalendarPublicationService } from "./google-calendar-publication.service.js";

@Controller("integrations/google-calendar")
@UseGuards(SupabaseAuthGuard)
export class GoogleCalendarPublicationController {
  constructor(
    @Inject(GoogleCalendarPublicationService)
    private readonly publications: GoogleCalendarPublicationService,
  ) {}

  @Post("publish")
  @HttpCode(202)
  publish(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.publications.publish(user.id, input);
  }

  @Get("publications")
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.publications.status(user.id);
  }
}
