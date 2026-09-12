import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  BadRequestException,
  type INestApplication,
  Module,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { GoogleConfig } from "../src/google/google.config.js";
import { GoogleCallbackService } from "../src/google/google-callback.service.js";
import { GoogleCalendarController } from "../src/google-calendar/google-calendar.controller.js";
import { GoogleCalendarService } from "../src/google-calendar/google-calendar.service.js";
import { GoogleSheetsController } from "../src/google-sheets/google-sheets.controller.js";
import { GoogleSheetsService } from "../src/google-sheets/google-sheets.service.js";

let returnUrl: string | undefined;
let received: unknown;
const calendarResult = { calendarId: "calendar-id", connected: true };
const sheetsResult = { connected: true };
function authorize(input: { error?: string }, result: unknown) {
  received = input;
  if (input.error) throw new BadRequestException("Sensitive provider details");
  return Promise.resolve(result);
}

@Module({
  controllers: [GoogleCalendarController, GoogleSheetsController],
  providers: [
    GoogleCallbackService,
    {
      provide: GoogleConfig,
      useValue: {
        get returnUrl() {
          return returnUrl;
        },
      },
    },
    { provide: ConfigService, useValue: { get: () => undefined } },
    {
      provide: GoogleCalendarService,
      useValue: {
        completeAuthorization: (input: { error?: string }) =>
          authorize(input, calendarResult),
      },
    },
    {
      provide: GoogleSheetsService,
      useValue: {
        callback: (input: { error?: string }) => authorize(input, sheetsResult),
      },
    },
  ],
})
class CallbackTestModule {}

describe("Google OAuth HTTP callbacks", () => {
  let app: INestApplication;
  let origin: string;

  beforeAll(async () => {
    app = await NestFactory.create(CallbackTestModule, {
      logger: false,
      abortOnError: false,
    });
    await app.listen(0, "127.0.0.1");
    origin = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    returnUrl = "https://wellspent.day/focus";
    received = undefined;
  });

  for (const integration of ["calendar", "sheets"] as const) {
    const path = `/integrations/google-${integration}/callback`;
    it(`returns ${integration} to the fixed application page after authorization`, async () => {
      const response = await fetch(
        `${origin}${path}?state=opaque-state&code=private-code&returnUrl=https://evil.example`,
        { redirect: "manual" },
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `https://wellspent.day/focus?google=${integration}&result=connected`,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
      expect(received).toMatchObject({
        state: "opaque-state",
        code: "private-code",
      });
    });

    it(`returns generic ${integration} failure without provider details`, async () => {
      const response = await fetch(
        `${origin}${path}?error=access_denied&state=private-state`,
        { redirect: "manual" },
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `https://wellspent.day/focus?google=${integration}&result=error`,
      );
      expect(await response.text()).toBe("");
    });

    it(`preserves ${integration} JSON success when no return URL is configured`, async () => {
      returnUrl = undefined;
      const response = await fetch(`${origin}${path}?state=state&code=code`, {
        redirect: "manual",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.json()).toEqual(
        integration === "calendar" ? calendarResult : sheetsResult,
      );
    });

    it(`preserves ${integration} HTTP errors when no return URL is configured`, async () => {
      returnUrl = undefined;
      const response = await fetch(`${origin}${path}?error=access_denied`, {
        redirect: "manual",
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    });
  }

  it("returns to a configured local app and replaces stale callback parameters", async () => {
    returnUrl = "http://localhost:3000/focus?google=sheets&result=error#stale";
    const response = await fetch(
      `${origin}/integrations/google-calendar/callback?state=state&code=code`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/focus?google=calendar&result=connected",
    );
  });
});
