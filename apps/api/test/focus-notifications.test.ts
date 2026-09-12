import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type Environment,
  validateEnvironment,
} from "../src/config/environment.js";
import { FocusNotificationsService } from "../src/focus/focus-notifications.service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const fetchSpy = spyOn(globalThis, "fetch");
const warnSpy = spyOn(Logger.prototype, "warn");
afterEach(() => {
  fetchSpy.mockReset();
  warnSpy.mockReset();
});
afterAll(() => {
  fetchSpy.mockRestore();
  warnSpy.mockRestore();
});

function service(enabled = true, key = "sb_secret_test") {
  return new FocusNotificationsService(
    new ConfigService<Environment, true>(
      validateEnvironment({
        DATABASE_URL: "postgresql://unused/unused",
        FOCUS_REALTIME_ENABLED: String(enabled),
        SUPABASE_URL: "http://127.0.0.1:54421",
        SUPABASE_SECRET_KEY: key,
      }),
    ),
  );
}

describe("focus commit notifications", () => {
  it("publishes only after the save resolves, with private metadata only", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 202 }));
    const saved = Promise.withResolvers<{ revision: number }>();
    const result = service().afterCommit(
      userId,
      sessionId,
      () => saved.promise,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    saved.resolve({ revision: 2 });
    expect(await result).toEqual({ revision: 2 });
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error("Expected broadcast request");
    const [url, options] = call;
    expect(String(url)).toBe(
      "http://127.0.0.1:54421/realtime/v1/api/broadcast",
    );
    expect(options?.headers).toEqual({
      "content-type": "application/json",
      apikey: "sb_secret_test",
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      messages: [
        {
          topic: `focus:${userId}`,
          event: "focus.changed",
          private: true,
          payload: { version: 1, sessionId },
        },
      ],
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not publish rejected or disabled operations", async () => {
    await expect(
      service().afterCommit(userId, sessionId, async () => {
        throw new Error("conflict");
      }),
    ).rejects.toThrow("conflict");
    expect(
      await service(false).afterCommit(userId, sessionId, async () => "saved"),
    ).toBe("saved");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves saved success after transport and HTTP failures", async () => {
    warnSpy.mockImplementation(() => {});
    fetchSpy.mockRejectedValueOnce(new Error("private error details"));
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 }));
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        await service().afterCommit(userId, sessionId, async () => "saved"),
      ).toBe("saved");
    }
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "private error details",
    );
  });

  it("supports the local legacy service-role JWT", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 202 }));
    await service(true, "local.jwt.key").afterCommit(
      userId,
      sessionId,
      async () => true,
    );
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer local.jwt.key",
    });
  });

  it("requires publisher configuration only when enabled", () => {
    const base = { DATABASE_URL: "postgresql://unused/unused" };
    expect(validateEnvironment(base).FOCUS_REALTIME_ENABLED).toBe(false);
    expect(() =>
      validateEnvironment({ ...base, FOCUS_REALTIME_ENABLED: "true" }),
    ).toThrow("SUPABASE_SECRET_KEY");
  });
});
