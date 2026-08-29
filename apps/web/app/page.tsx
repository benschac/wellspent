import { createApiClient } from "@repo/api-client";
import { env } from "./env";

export const dynamic = "force-dynamic";

async function readApiStatus() {
  try {
    return await createApiClient(env.API_URL).health();
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await readApiStatus();

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Bun + Turborepo starter</p>
        <h1>One contract. Three applications.</h1>
        <p className="lede">
          Next.js and Expo consume the same typed oRPC contract implemented by
          a feature-oriented NestJS backend.
        </p>

        <div className="status-card">
          <span
            aria-hidden="true"
            className={health ? "status-dot status-dot--online" : "status-dot"}
          />
          <div>
            <p className="status-title">
              API {health ? "connected" : "unavailable"}
            </p>
            <p className="status-copy">
              {health
                ? `Last checked ${new Date(health.timestamp).toLocaleTimeString()}`
                : "Start the NestJS app on port 3001 to complete the request."}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
