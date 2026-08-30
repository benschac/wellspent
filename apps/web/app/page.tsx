import { env } from "./env";
import { TimerClient } from "./timer-client";
import Link from "next/link";

export default function HomePage() {
  const realtimeUrl = new URL("/api/ws", env.API_URL);
  realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";

  return (
    <main>
      <TimerClient realtimeUrl={realtimeUrl.toString()} />
      <Link className="assistant-link" href="/assistant">
        Open focus assistant
      </Link>
    </main>
  );
}
