import { describe, expect, it, mock } from "bun:test";
import { triggerGoogleCalendarJobBatch } from "../api/google-calendar-jobs.mjs";

describe("Calendar queue consumer", () => {
  it("invokes the existing authenticated batch executor on its deployment", async () => {
    const fetcher = mock(async () => new Response(null, { status: 200 }));

    await triggerGoogleCalendarJobBatch(
      {
        CRON_SECRET: "test-scheduler-secret",
        VERCEL_URL: "api-deployment.example",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        "https://api-deployment.example/api/integrations/google-calendar/jobs/run",
      ),
      {
        headers: { authorization: "Bearer test-scheduler-secret" },
        method: "GET",
      },
    );
  });

  it("retries through Vercel Queues when dispatch configuration or execution fails", async () => {
    await expect(
      triggerGoogleCalendarJobBatch(
        {},
        mock(async () => new Response()),
      ),
    ).rejects.toThrow("environment is incomplete");
    await expect(
      triggerGoogleCalendarJobBatch(
        {
          CRON_SECRET: "test-scheduler-secret",
          VERCEL_URL: "api-deployment.example",
        },
        mock(async () => new Response(null, { status: 503 })),
      ),
    ).rejects.toThrow("HTTP 503");
  });
});
