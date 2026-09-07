import { ORPCError } from "@orpc/server";
import {
  transitionState as domainTransitionState,
  validateEventTime as domainValidateEventTime,
  SessionDomainError,
} from "@repo/session-domain";

export {
  buildFocusDetail,
  MAX_EVENTS,
  MAX_SEGMENTS,
  SEGMENT_MS,
  type Transition,
} from "@repo/session-domain";

function mapDomainError<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SessionDomainError) {
      throw new ORPCError(
        error.reason === "invalid_event_time" ? "BAD_REQUEST" : "CONFLICT",
        { message: error.message },
      );
    }
    throw error;
  }
}
export function transitionState(
  ...args: Parameters<typeof domainTransitionState>
) {
  return mapDomainError(() => domainTransitionState(...args));
}
export function validateEventTime(
  ...args: Parameters<typeof domainValidateEventTime>
) {
  return mapDomainError(() => domainValidateEventTime(...args));
}
