import type { FocusCommand } from "./schemas.ts";

const sessionId = "10000000-0000-4000-8000-000000000001";
export const start = {
  type: "create",
  input: {
    id: sessionId,
    commandId: "20000000-0000-4000-8000-000000000001",
    intention: "Fix login",
    occurredAt: "2026-09-05T12:00:00.000Z",
  },
} satisfies FocusCommand;
export const pause = {
  type: "transition",
  input: {
    sessionId,
    commandId: "20000000-0000-4000-8000-000000000002",
    action: "pause",
    expectedRevision: 1,
    occurredAt: "2026-09-05T12:15:00.000Z",
  },
} satisfies FocusCommand;
export const resume = {
  type: "transition",
  input: {
    sessionId,
    commandId: "20000000-0000-4000-8000-000000000003",
    action: "resume",
    expectedRevision: 2,
    occurredAt: "2026-09-05T12:45:00.000Z",
  },
} satisfies FocusCommand;
export const finish = {
  type: "transition",
  input: {
    sessionId,
    commandId: "20000000-0000-4000-8000-000000000004",
    action: "finish",
    expectedRevision: 3,
    occurredAt: "2026-09-05T13:00:00.000Z",
  },
} satisfies FocusCommand;
