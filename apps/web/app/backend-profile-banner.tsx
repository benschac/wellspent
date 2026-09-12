"use client";

import { env } from "./env";

export function BackendProfileBanner() {
  const profile = process.env.NEXT_PUBLIC_APP_ENV;
  if (process.env.NODE_ENV !== "development" || !profile) return null;
  const production = profile === "prod-api";
  return (
    <aside
      aria-label="Backend environment"
      style={{
        background: production ? "#713f12" : "#164e63",
        color: "#fff",
        fontSize: "0.875rem",
        padding: "0.5rem 1rem",
        textAlign: "center",
      }}
    >
      <strong>
        {production ? "PRODUCTION API — actions affect real data" : "LOCAL API"}
      </strong>
      {" · "}
      {env.NEXT_PUBLIC_API_URL}
    </aside>
  );
}
