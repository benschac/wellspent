import type { Metadata } from "next";
import Link from "next/link";
import { FocusClient } from "../focus/focus-client";
import "../focus/focus.css";

export const metadata: Metadata = {
  title: "Work log · Timer",
  description: "A durable history of work from your CLI and agents.",
};

export default function WorkLogPage() {
  return (
    <main className="focus-page">
      <div className="focus-shell">
        <header className="focus-header">
          <Link href="/" className="eyebrow">
            Timer
          </Link>
          <h1>Keep a record of your work.</h1>
          <p className="lede">
            Log from your CLI or agent. Come back to what you did. No timer
            required.
          </p>
          <Link href="/focus" className="focus-text-button">
            Focus sessions
          </Link>
        </header>
        <FocusClient view="work-log" />
      </div>
    </main>
  );
}
