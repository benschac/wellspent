import { describe, expect, it, mock } from "bun:test";
import { UnauthorizedException } from "@nestjs/common";
import type { GoogleOAuthService } from "../src/google/google-oauth.service.js";
import type { GoogleCalendarConfig } from "../src/google-calendar/google-calendar.config.js";
import type { GoogleCalendarRepository } from "../src/google-calendar/google-calendar.repository.js";
import type { GoogleCalendarClient } from "../src/google-calendar/google-calendar.types.js";
import type { GoogleCalendarJobDispatcher } from "../src/google-calendar/google-calendar-job-dispatcher.js";
import { createCalendarPublication } from "../src/google-calendar/google-calendar-publication.js";
import { GoogleCalendarPublicationService } from "../src/google-calendar/google-calendar-publication.service.js";

const session = {
  id: "10000000-0000-4000-8000-000000000001",
  revision: 4,
  intention: "Finish a task",
  status: "completed",
  recapText: "Done",
  createdAt: new Date("2026-09-07T10:00:00.000Z"),
  completedAt: new Date("2026-09-07T11:00:00.123Z"),
  elapsedMs: 1_800_123,
};

function subject(rows = [session]) {
  const calls: string[] = [];
  const repository = {
    findConnectionByUserId: mock(async () => ({
      id: "connection",
      calendarId: "calendar",
      status: "connected",
    })),
    findConnectionById: mock(async () => ({
      id: "connection",
      calendarId: "calendar",
      userId: "user",
    })),
    findCompletedPublicationSessions: mock(async () => rows),
    enqueuePublications: mock(async () => {
      calls.push("enqueue");
    }),
    recordPublication: mock(async () => {}),
    markReconnectRequired: mock(async () => {}),
  };
  const dispatcher = {
    dispatch: mock(async () => {
      calls.push("dispatch");
    }),
  };
  const oauth = {
    status: mock(async () => ({ authorized: true })),
    getAccessToken: mock(async () => "access"),
  };
  const client = { publishEvent: mock(async () => {}) };
  const service = new GoogleCalendarPublicationService(
    {
      enabled: true,
      assertEnabled: () => {},
    } as unknown as GoogleCalendarConfig,
    repository as unknown as GoogleCalendarRepository,
    dispatcher as unknown as GoogleCalendarJobDispatcher,
    oauth as unknown as GoogleOAuthService,
    client as unknown as GoogleCalendarClient,
  );
  return { calls, repository, dispatcher, oauth, client, service };
}

describe("Calendar completed session publication", () => {
  it("uses deterministic provider IDs and preserves wall span, precision, and focused duration separately", () => {
    const publication = createCalendarPublication("connection", session);
    expect(publication.event.id).toMatch(/^[0-9a-f]{64}$/);
    expect(publication.event.id).toBe(
      createCalendarPublication("connection", {
        ...session,
        recapText: "Later recap",
      }).event.id,
    );
    expect(publication.event.id).not.toBe(
      createCalendarPublication("other connection", session).event.id,
    );
    expect(publication.event.start.dateTime).toBe("2026-09-07T10:00:00.000Z");
    expect(publication.event.end.dateTime).toBe("2026-09-07T11:00:00.123Z");
    expect(publication.event.description).toContain(
      "1800.123 seconds (pauses excluded)",
    );
    expect(publication.event.transparency).toBe("transparent");
  });

  it("rejects unfinished and zero-span sessions without inventing calendar time", () => {
    expect(() =>
      createCalendarPublication("connection", {
        ...session,
        status: "running",
      }),
    ).toThrow("completed");
    expect(() =>
      createCalendarPublication("connection", {
        ...session,
        completedAt: session.createdAt,
      }),
    ).toThrow("positive time span");
  });

  it("validates the complete owner-scoped selection before durably queuing; no Google write in HTTP request", async () => {
    const s = subject();
    expect(
      await s.service.publish("user", { sessionIds: [session.id] }),
    ).toEqual({ queuedSessionCount: 1 });
    expect(s.repository.findCompletedPublicationSessions).toHaveBeenCalledWith(
      "user",
      [session.id],
    );
    expect(s.repository.enqueuePublications).toHaveBeenCalledTimes(1);
    expect(s.dispatcher.dispatch).toHaveBeenCalledWith(1);
    expect(s.calls).toEqual(["enqueue", "dispatch"]);
    expect(s.client.publishEvent).not.toHaveBeenCalled();
    const missing = subject([]);
    await expect(
      missing.service.publish("user", { sessionIds: [session.id] }),
    ).rejects.toThrow("not found");
    expect(missing.repository.enqueuePublications).not.toHaveBeenCalled();
    expect(missing.dispatcher.dispatch).not.toHaveBeenCalled();
    await expect(
      s.service.publish("user", { sessionIds: [session.id, session.id] }),
    ).rejects.toThrow("unique");
  });

  it("records the event link only after provider success and marks revoked credentials for reconnect", async () => {
    const s = subject();
    const payload = createCalendarPublication("connection", session);
    await s.service.run("connection", payload);
    expect(s.client.publishEvent).toHaveBeenCalledTimes(1);
    expect(s.repository.recordPublication).toHaveBeenCalledWith(
      "connection",
      "calendar",
      payload,
    );
    s.repository.recordPublication.mockClear();
    s.oauth.getAccessToken.mockImplementation(async () => {
      throw new UnauthorizedException();
    });
    await expect(s.service.run("connection", payload)).rejects.toThrow();
    expect(s.repository.markReconnectRequired).toHaveBeenCalledWith(
      "connection",
    );
    expect(s.repository.recordPublication).not.toHaveBeenCalled();
  });
});
