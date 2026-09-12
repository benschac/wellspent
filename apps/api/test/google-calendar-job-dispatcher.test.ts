import { describe, expect, it, mock } from "bun:test";
import type { GoogleCalendarConfig } from "../src/google-calendar/google-calendar.config.js";
import {
  GOOGLE_CALENDAR_JOBS_TOPIC,
  GoogleCalendarJobDispatcher,
  type GoogleCalendarQueueSend,
} from "../src/google-calendar/google-calendar-job-dispatcher.js";

describe("Calendar job dispatch", () => {
  it("sends one bounded queue wake-up per worker batch on Vercel", async () => {
    const send = mock(async () => ({}));
    const dispatcher = new GoogleCalendarJobDispatcher(
      { serverless: true } as GoogleCalendarConfig,
      send as GoogleCalendarQueueSend,
    );

    await dispatcher.dispatch(21);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([topic, payload]) => [topic, payload])).toEqual(
      [
        [GOOGLE_CALENDAR_JOBS_TOPIC, { batch: 0 }],
        [GOOGLE_CALENDAR_JOBS_TOPIC, { batch: 1 }],
        [GOOGLE_CALENDAR_JOBS_TOPIC, { batch: 2 }],
      ],
    );
  });

  it("leaves local execution to the in-process worker", async () => {
    const send = mock(async () => ({}));
    const dispatcher = new GoogleCalendarJobDispatcher(
      { serverless: false } as GoogleCalendarConfig,
      send as GoogleCalendarQueueSend,
    );

    await dispatcher.dispatch(21);

    expect(send).not.toHaveBeenCalled();
  });
});
