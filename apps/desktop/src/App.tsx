import { formatElapsedTime, useStopwatch } from "@repo/timer";

import "./App.css";

function getRealtimeUrl(): string | undefined {
  const apiUrl = import.meta.env.VITE_API_URL;

  if (!apiUrl) {
    return undefined;
  }

  const realtimeUrl = new URL("/api/ws", apiUrl);
  realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";

  return realtimeUrl.toString();
}

const realtimeUrl = getRealtimeUrl();

function App() {
  const { elapsedMs, isRunning, pause, reset, start } = useStopwatch(
    realtimeUrl ? { realtimeUrl } : {},
  );
  const formattedTime = formatElapsedTime(elapsedMs);

  return (
    <main>
      <section className="timer-shell">
        <header className="timer-heading">
          <p className="eyebrow">Desktop timer</p>
          <h1>Every hundredth counts.</h1>
          <p className="lede">Shared timer logic, running inside Tauri.</p>
        </header>

        <div aria-label={formattedTime.label} className="timer-dial" role="timer">
          <div aria-hidden="true" className="timer-dial__inner">
            <div className="timer-readout">
              <span>{formattedTime.minutes}</span>
              <span className="timer-readout__separator">:</span>
              <span>{formattedTime.seconds}</span>
              <span className="timer-readout__hundredths">
                .{formattedTime.hundredths}
              </span>
            </div>
          </div>
        </div>

        <div className="timer-controls">
          <button
            className="timer-button timer-button--primary"
            onClick={isRunning ? pause : start}
            type="button"
          >
            {isRunning ? "Pause" : elapsedMs > 0 ? "Resume" : "Start"}
          </button>
          <button className="timer-button" onClick={reset} type="button">
            Reset
          </button>
        </div>

        <p className="timer-note">
          {realtimeUrl
            ? "Realtime sync is configured for the shared timer service."
            : "Running locally. Set VITE_API_URL to enable realtime sync."}
        </p>
      </section>
    </main>
  );
}

export default App;
