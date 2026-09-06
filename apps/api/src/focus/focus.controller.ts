import { Controller, Headers, UseGuards } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { apiContract } from "@repo/api-contract";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { FocusRepository } from "./focus.repository.js";

@Controller()
@UseGuards(SupabaseAuthGuard)
export class FocusController {
  constructor(private readonly repository: FocusRepository) {}

  @Implement(apiContract.focus.list)
  list(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.focus.list).handler(() =>
      this.repository.list(user.id),
    );
  }
  @Implement(apiContract.focus.create)
  create(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.focus.create).handler(({ input }) =>
      this.repository.create(user.id, input),
    );
  }
  @Implement(apiContract.focus.get)
  get(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.focus.get).handler(({ input }) =>
      this.repository.get(user.id, input.sessionId),
    );
  }
  @Implement(apiContract.focus.transition)
  transition(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.focus.transition).handler(({ input }) =>
      this.repository.transition(user.id, input),
    );
  }
  @Implement(apiContract.focus.updateRecap)
  updateRecap(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.focus.updateRecap).handler(({ input }) =>
      this.repository.updateRecap(user.id, input),
    );
  }
  @Implement(apiContract.focus.addNote)
  addNote(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.focus.addNote).handler(({ input }) =>
      this.repository.addNote(user.id, input),
    );
  }
  @Implement(apiContract.focus.createCaptureToken)
  createCaptureToken(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.focus.createCaptureToken).handler(
      ({ input }) =>
        this.repository.createCaptureToken(user.id, input.sessionId),
    );
  }
  @Implement(apiContract.focus.revokeCaptureToken)
  revokeCaptureToken(@CurrentUser() user: AuthenticatedUser) {
    return implement(apiContract.focus.revokeCaptureToken).handler(
      ({ input }) =>
        this.repository.revokeCaptureToken(user.id, input.sessionId),
    );
  }
}

/** Capture credentials never authorize reading history or controlling a timer. */
@Controller()
export class FocusCaptureController {
  constructor(private readonly repository: FocusRepository) {}

  @Implement(apiContract.focus.ingest)
  ingest(@Headers("authorization") authorization: string | undefined) {
    return implement(apiContract.focus.ingest).handler(({ input }) =>
      this.repository.ingest(authorization, input.sessionId, input.events),
    );
  }
}
