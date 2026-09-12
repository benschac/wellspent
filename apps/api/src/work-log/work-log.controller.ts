import { Controller, Headers, Inject, UseGuards } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { apiContract } from "@repo/api-contract";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { SupabaseAuthService } from "../auth/supabase-auth.service.js";
import { WorkLogRepository } from "./work-log.repository.js";

@Controller()
export class WorkLogController {
  constructor(
    @Inject(WorkLogRepository) private readonly repository: WorkLogRepository,
    @Inject(SupabaseAuthService) private readonly auth: SupabaseAuthService,
  ) {}

  private async principal(authorization: string | undefined) {
    if (authorization?.startsWith("Bearer twl_"))
      return this.repository.authenticateToken(authorization);
    const user = await this.auth.authenticate(authorization);
    return { userId: user.id };
  }
  @Implement(apiContract.workLog.identity)
  identity(@Headers("authorization") authorization: string | undefined) {
    return implement(apiContract.workLog.identity).handler(async () =>
      this.repository.identity(await this.principal(authorization)),
    );
  }
  @Implement(apiContract.workLog.ingest)
  ingest(@Headers("authorization") authorization: string | undefined) {
    return implement(apiContract.workLog.ingest).handler(async ({ input }) =>
      this.repository.ingest(await this.principal(authorization), input.events),
    );
  }
  @Implement(apiContract.workLog.list)
  list(@Headers("authorization") authorization: string | undefined) {
    return implement(apiContract.workLog.list).handler(async ({ input }) =>
      this.repository.list(await this.principal(authorization), input),
    );
  }
}

/** Account login, never a work-log credential, authorizes credential management. */
@Controller()
@UseGuards(SupabaseAuthGuard)
export class WorkLogTokensController {
  constructor(
    @Inject(WorkLogRepository) private readonly repository: WorkLogRepository,
  ) {}
  @Implement(apiContract.workLog.createToken)
  createToken(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.workLog.createToken).handler(({ input }) =>
      this.repository.createToken(user.id, input.label),
    );
  }
  @Implement(apiContract.workLog.listTokens)
  listTokens(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.workLog.listTokens).handler(() =>
      this.repository.listTokens(user.id),
    );
  }
  @Implement(apiContract.workLog.revokeToken)
  revokeToken(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.workLog.revokeToken).handler(({ input }) =>
      this.repository.revokeToken(user.id, input.id),
    );
  }
}
