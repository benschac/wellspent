import { Controller, UseGuards } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { apiContract } from "@repo/api-contract";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { ProfileService } from "./profile.service.js";

@Controller()
@UseGuards(SupabaseAuthGuard)
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  @Implement(apiContract.profile.get)
  get(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.profile.get).handler(() =>
      this.service.get(user.id),
    );
  }

  @Implement(apiContract.profile.update)
  update(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.profile.update).handler(({ input }) =>
      this.service.update(user.id, input),
    );
  }
}
