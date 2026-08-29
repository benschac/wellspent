import { Module } from "@nestjs/common";
import { SupabaseAuthGuard } from "./supabase-auth.guard.js";
import { SupabaseAuthService } from "./supabase-auth.service.js";

@Module({
  providers: [SupabaseAuthGuard, SupabaseAuthService],
  exports: [SupabaseAuthGuard, SupabaseAuthService],
})
export class AuthModule {}
