import { env } from "./env";
import { TimerClient } from "./timer-client";

export default function HomePage() {
  const realtimeUrl = new URL("/api/ws", env.API_URL);
  realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";

  return (
    <main>
      <TimerClient realtimeUrl={realtimeUrl.toString()} />
    </main>
  );
}
