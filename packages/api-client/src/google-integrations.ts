export type GoogleIntegration = "calendar" | "sheets";

export type GoogleIntegrationStatus = {
  enabled: boolean;
  connected: boolean;
  reconnectRequired: boolean;
};

export type CalendarPublication = {
  sessionId: string;
  status: "pending" | "processing" | "completed" | "dead";
  lastError: string | null;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Google integration returned an unexpected response.");
  return value as Record<string, unknown>;
}

function googleUrl(value: unknown, host: string, pathPrefix: string): string {
  if (typeof value !== "string")
    throw new Error("Google integration returned an invalid link.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== host ||
    url.port !== "" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(pathPrefix)
  )
    throw new Error("Google integration returned an invalid link.");
  return url.href;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Google integration returned an unexpected response.");
  return value;
}

/** REST endpoints share the focus client's existing account-bound token owner. */
export function createGoogleIntegrationsClient(
  origin: string,
  options: { getAccessToken: () => Promise<string | null> },
) {
  async function request(
    feature: GoogleIntegration,
    path: string,
    method: "GET" | "POST" | "DELETE",
    signal?: AbortSignal,
    body?: unknown,
  ): Promise<unknown> {
    const token = await options.getAccessToken();
    if (!token) throw new Error("Sign in again to use Google integrations.");
    const response = await fetch(
      new URL(`/api/integrations/google-${feature}${path}`, origin),
      {
        method,
        ...(signal === undefined ? {} : { signal }),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (!response.ok) {
      if (response.status === 401)
        throw new Error("Sign in again to use Google integrations.");
      // Provider errors can include work content or credentials. Never render them.
      throw new Error(
        "The Google integration request failed. Check the connection and try again.",
      );
    }
    return response.status === 204 ? undefined : response.json();
  }

  return {
    async status(
      feature: GoogleIntegration,
      signal?: AbortSignal,
    ): Promise<GoogleIntegrationStatus> {
      const value = record(await request(feature, "/status", "GET", signal));
      if (
        typeof value.enabled !== "boolean" ||
        typeof value.connected !== "boolean" ||
        typeof value.reconnectRequired !== "boolean"
      )
        throw new Error("Google integration returned an unexpected response.");
      return {
        enabled: value.enabled,
        connected: value.connected,
        reconnectRequired: value.reconnectRequired,
      };
    },
    async connect(feature: GoogleIntegration, signal?: AbortSignal) {
      const value = record(await request(feature, "/connect", "GET", signal));
      return googleUrl(
        value.authorizationUrl,
        "accounts.google.com",
        "/o/oauth2/",
      );
    },
    async disconnect(feature: GoogleIntegration, signal?: AbortSignal) {
      await request(feature, "", "DELETE", signal);
    },
    async exportSessions(sessionIds: string[], signal?: AbortSignal) {
      const value = record(
        await request("sheets", "/export", "POST", signal, { sessionIds }),
      );
      return {
        spreadsheetUrl: googleUrl(
          value.spreadsheetUrl,
          "docs.google.com",
          "/spreadsheets/d/",
        ),
        exportedSessionCount: count(value.exportedSessionCount),
      };
    },
    async publishSessions(sessionIds: string[], signal?: AbortSignal) {
      const value = record(
        await request("calendar", "/publish", "POST", signal, { sessionIds }),
      );
      return { queuedSessionCount: count(value.queuedSessionCount) };
    },
    async publications(signal?: AbortSignal): Promise<CalendarPublication[]> {
      const value = record(
        await request("calendar", "/publications", "GET", signal),
      );
      if (!Array.isArray(value.publications))
        throw new Error("Google integration returned an unexpected response.");
      return value.publications.map((item: unknown) => {
        const publication = record(item);
        if (
          typeof publication.sessionId !== "string" ||
          !["pending", "processing", "completed", "dead"].includes(
            String(publication.status),
          ) ||
          (publication.lastError !== null &&
            typeof publication.lastError !== "string")
        )
          throw new Error(
            "Google integration returned an unexpected response.",
          );
        return {
          sessionId: publication.sessionId,
          status: publication.status as CalendarPublication["status"],
          lastError: publication.lastError as string | null,
        };
      });
    },
  };
}

export type GoogleIntegrationsClient = ReturnType<
  typeof createGoogleIntegrationsClient
>;
