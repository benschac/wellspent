import type { Metadata } from "next";
import Link from "next/link";
import { FocusClient } from "./focus-client";
import "./focus.css";

export const metadata: Metadata = {
  title: "Focus sessions · Timer",
  description:
    "Keep a durable record of focused work and the evidence behind it.",
};

export default function FocusPage() {
  return (
    <main className="focus-page">
      <div className="focus-shell">
        <header className="focus-header">
          <Link href="/" className="eyebrow">
            Timer
          </Link>
          <h1>Make your focus visible.</h1>
          <p className="lede">
            Choose an intention. Keep your time. See what moved forward.
          </p>
          <Link href="/work-log" className="focus-text-button">
            View your CLI work log
          </Link>
        </header>
        <FocusClient />
      </div>
    </main>
  );
}
