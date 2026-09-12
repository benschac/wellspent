import { QueueClient } from "@vercel/queue";

const queue = new QueueClient();
const calendarJobPath = "/api/integrations/google-calendar/jobs/run";

export async function triggerGoogleCalendarJobBatch(
  environment = process.env,
  fetcher = fetch,
) {
  const cronSecret = environment.CRON_SECRET;
  const deploymentHost = environment.VERCEL_URL;
  if (!cronSecret || !deploymentHost) {
    throw new Error("Calendar queue consumer environment is incomplete");
  }

  const response = await fetcher(
    new URL(calendarJobPath, `https://${deploymentHost}`),
    {
      headers: { authorization: `Bearer ${cronSecret}` },
      method: "GET",
    },
  );
  if (!response.ok) {
    throw new Error(`Calendar job executor returned HTTP ${response.status}`);
  }
}

export default queue.handleNodeCallback(() => triggerGoogleCalendarJobBatch());
