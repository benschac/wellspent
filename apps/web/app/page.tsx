import Link from "next/link";
import { env } from "./env";
import { TimerClient } from "./timer-client";

export default function HomePage() {
  const realtimeUrl = new URL("/api/ws", env.API_URL);
  realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";

  return (
    <main>
      <Link
        className="timer-button timer-button--primary focus-home-link"
        href="/focus"
      >
        Start a focus session
      </Link>
      <TimerClient realtimeUrl={realtimeUrl.toString()} />
      <Link className="assistant-link" href="/assistant">
        Open focus assistant
      </Link>
    </main>
  );
}
