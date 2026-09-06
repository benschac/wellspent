import {
  Controller,
  Delete,
  HttpCode,
  Inject,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { GoogleOAuthService } from "./google-oauth.service.js";

@Controller("integrations/google")
@UseGuards(SupabaseAuthGuard)
export class GoogleController {
  constructor(
    @Inject(GoogleOAuthService) private readonly oauth: GoogleOAuthService,
  ) {}
  @Delete()
  @HttpCode(204)
  disconnectAll(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.disconnectAll(user.id);
  }
}
