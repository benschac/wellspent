import { expect, it } from "bun:test";
import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { call } from "@orpc/server";
import { workLogEventInputSchema } from "@repo/api-contract";
import { SupabaseAuthGuard } from "../src/auth/supabase-auth.guard.js";
import type { SupabaseAuthService } from "../src/auth/supabase-auth.service.js";
import {
  WorkLogController,
  WorkLogTokensController,
} from "../src/work-log/work-log.controller.js";
import {
  type WorkLogRepository,
  workLogFingerprint,
} from "../src/work-log/work-log.repository.js";

it("normalizes equivalent timestamps for idempotency and rejects account injection", () => {
  const event = {
    id: crypto.randomUUID(),
    occurredAt: "2026-09-01T00:00:00Z",
    source: "cli" as const,
    sourceSessionId: "shell",
    kind: "note" as const,
    summary: "Fixed a bug",
  };
  expect(workLogFingerprint(event)).toBe(
    workLogFingerprint({ ...event, occurredAt: "2026-09-01T00:00:00.000Z" }),
  );
  expect(
    workLogEventInputSchema.safeParse({ ...event, userId: crypto.randomUUID() })
      .success,
  ).toBe(false);
  expect(
    workLogEventInputSchema.safeParse({ ...event, occurredAt: "invalid" })
      .success,
  ).toBe(false);
  expect(
    workLogEventInputSchema.safeParse({ ...event, summary: " " }).success,
  ).toBe(false);
});

it("routes work-log credentials separately and requires account login for token management", async () => {
  const userId = crypto.randomUUID();
  const calls: string[] = [];
  const repository = {
    authenticateToken: async (authorization: string) => {
      calls.push(authorization);
      return { userId, tokenHash: "test" };
    },
    identity: async (principal: { userId: string }) => ({
      userId: principal.userId,
    }),
  } as unknown as WorkLogRepository;
  const auth = {
    authenticate: async (authorization: string) => {
      calls.push(authorization);
      if (authorization !== "Bearer account-jwt")
        throw new Error("Invalid account token");
      return { id: userId };
    },
  } as unknown as SupabaseAuthService;
  const controller = new WorkLogController(repository, auth);
  expect(await call(controller.identity("Bearer twl_test"), undefined)).toEqual(
    { userId },
  );
  expect(
    await call(controller.identity("Bearer account-jwt"), undefined),
  ).toEqual({ userId });
  await expect(
    call(controller.identity("Bearer timer_capture_test"), undefined),
  ).rejects.toThrow("Invalid account token");
  expect(calls).toEqual([
    "Bearer twl_test",
    "Bearer account-jwt",
    "Bearer timer_capture_test",
  ]);
  expect(
    Reflect.getMetadata(GUARDS_METADATA, WorkLogTokensController),
  ).toContain(SupabaseAuthGuard);
});
