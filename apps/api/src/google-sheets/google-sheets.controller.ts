import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import {
  type GoogleCallbackResponse,
  GoogleCallbackService,
} from "../google/google-callback.service.js";
import { GoogleCallbackQueryDto } from "../google/google-callback-query.dto.js";
import { GoogleSheetsService } from "./google-sheets.service.js";

@Controller("integrations/google-sheets")
export class GoogleSheetsController {
  constructor(
    @Inject(GoogleSheetsService) private readonly service: GoogleSheetsService,
    @Inject(GoogleCallbackService)
    private readonly callbackService: GoogleCallbackService,
  ) {}
  @Get("connect")
  @UseGuards(SupabaseAuthGuard)
  connect(@CurrentUser() user: AuthenticatedUser) {
    return this.service.connect(user.id);
  }
  @Get("callback")
  callback(
    @Query(new ValidationPipe({ expectedType: GoogleCallbackQueryDto }))
    input: GoogleCallbackQueryDto,
    @Res({ passthrough: true }) response: GoogleCallbackResponse,
  ) {
    return this.callbackService.complete(
      "sheets",
      () => this.service.callback(input),
      response,
    );
  }
  @Get("status")
  @UseGuards(SupabaseAuthGuard)
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.service.status(user.id);
  }
  @Delete()
  @HttpCode(204)
  @UseGuards(SupabaseAuthGuard)
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.service.disconnect(user.id);
  }
  @Post("export")
  @UseGuards(SupabaseAuthGuard)
  exportSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    return this.service.exportSessions(user.id, input);
  }
}
