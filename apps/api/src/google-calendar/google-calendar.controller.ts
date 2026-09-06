import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { GoogleCallbackQueryDto } from "../google/google-callback-query.dto.js";
import { GoogleCalendarService } from "./google-calendar.service.js";

@Controller("integrations/google-calendar")
export class GoogleCalendarController {
  constructor(
    @Inject(GoogleCalendarService)
    private readonly service: GoogleCalendarService,
  ) {}

  @Get("connect")
  @UseGuards(SupabaseAuthGuard)
  connect(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ authorizationUrl: string }> {
    return this.service.beginAuthorization(user.id);
  }

  @Get("callback")
  callback(
    @Query(new ValidationPipe({ expectedType: GoogleCallbackQueryDto }))
    query: GoogleCallbackQueryDto,
  ): Promise<{ calendarId: string; connected: true }> {
    return this.service.completeAuthorization(query);
  }

  @Get("status")
  @UseGuards(SupabaseAuthGuard)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getStatus(user.id);
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(SupabaseAuthGuard)
  disconnect(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.service.disconnect(user.id);
  }

  @Post("webhook")
  @HttpCode(204)
  webhook(
    @Headers("x-goog-channel-id") channelId?: string,
    @Headers("x-goog-channel-token") channelToken?: string,
    @Headers("x-goog-message-number") messageNumber?: string,
    @Headers("x-goog-resource-id") resourceId?: string,
    @Headers("x-goog-resource-state") resourceState?: string,
  ): Promise<void> {
    return this.service.receiveNotification({
      ...(channelId === undefined ? {} : { channelId }),
      ...(channelToken === undefined ? {} : { channelToken }),
      ...(messageNumber === undefined ? {} : { messageNumber }),
      ...(resourceId === undefined ? {} : { resourceId }),
      ...(resourceState === undefined ? {} : { resourceState }),
    });
  }
}
