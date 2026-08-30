import Link from "next/link";
import { AssistantClient } from "./assistant-client";

export default function AssistantPage() {
  return (
    <main>
      <section className="assistant-shell">
        <header className="assistant-heading">
          <p className="eyebrow">Focus assistant</p>
          <h1>What will you finish next?</h1>
          <p className="lede">
            Turn an open-ended task into one realistic focus interval.
          </p>
        </header>
        <AssistantClient />
        <Link className="assistant-link" href="/">
          Back to timer
        </Link>
      </section>
    </main>
  );
}
