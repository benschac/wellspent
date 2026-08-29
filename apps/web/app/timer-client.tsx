"use client";

import { formatElapsedTime, useStopwatch } from "@repo/timer";
import dynamic from "next/dynamic";

const dialSize = 300;
const SkiaDial = dynamic(
  () => import("./skia-dial").then((module) => module.SkiaDial),
  {
    loading: () => <div aria-hidden="true" className="timer-dial__loading" />,
    ssr: false,
  },
);

interface TimerClientProps {
  realtimeUrl: string;
}

export function TimerClient({ realtimeUrl }: TimerClientProps) {
  const { elapsedMs, isRunning, pause, reset, start } = useStopwatch({
    realtimeUrl,
  });
  const formattedTime = formatElapsedTime(elapsedMs);

  return (
    <section className="timer-shell">
      <header className="timer-heading">
        <p className="eyebrow">Precision timer</p>
        <h1>Every hundredth counts.</h1>
        <p className="lede">Monotonic time, rendered with Skia on every frame.</p>
      </header>

      <div
        aria-label={formattedTime.label}
        className="timer-dial"
        role="timer"
      >
        <SkiaDial elapsedMs={elapsedMs} size={dialSize} />
        <div aria-hidden="true" className="timer-readout">
          <span>{formattedTime.minutes}</span>
          <span className="timer-readout__separator">:</span>
          <span>{formattedTime.seconds}</span>
          <span className="timer-readout__hundredths">
            .{formattedTime.hundredths}
          </span>
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
        Time is calculated from the clock, not by counting timer callbacks.
      </p>
    </section>
  );
}
