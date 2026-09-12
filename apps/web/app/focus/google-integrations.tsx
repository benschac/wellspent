"use client";

import type {
  CalendarPublication,
  GoogleIntegration,
  GoogleIntegrationStatus,
  GoogleIntegrationsClient,
} from "@repo/api-client";
import { useAbortController } from "@repo/lib/hooks/use-abort-controller";
import { useEffect, useRef, useState } from "react";
import type { FocusSession } from "./focus-state";
import { googleCallbackMessage } from "./google-integration-state";

const features = ["sheets", "calendar"] as const;
const names = { sheets: "Google Sheets", calendar: "Google Calendar" };

export function GoogleIntegrations({
  client,
  sessionIds,
  sessions,
}: {
  client: GoogleIntegrationsClient;
  sessionIds: string[];
  sessions: FocusSession[];
}) {
  const [statuses, setStatuses] = useState<
    Partial<Record<GoogleIntegration, GoogleIntegrationStatus>>
  >({});
  const [statusErrors, setStatusErrors] = useState<
    Partial<Record<GoogleIntegration, string>>
  >({});
  const [refresh, setRefresh] = useState(0);
  const [publicationRefresh, setPublicationRefresh] = useState(0);
  const [busy, setBusy] = useState<GoogleIntegration | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{
    spreadsheetUrl: string;
    exportedSessionCount: number;
  } | null>(null);
  const [publications, setPublications] = useState<CalendarPublication[]>([]);
  const [publicationError, setPublicationError] = useState(false);
  const actions = useAbortController();
  const statusRequests = useAbortController();
  const publicationRequests = useAbortController();
  const actionInFlight = useRef(false);

  useEffect(() => {
    const result = googleCallbackMessage(window.location.search);
    if (result) {
      setMessage(result);
      const url = new URL(window.location.href);
      url.searchParams.delete("google");
      url.searchParams.delete("result");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit status refresh invalidates the previous request.
  useEffect(() => {
    const signal = statusRequests.restart();
    setStatusErrors({});
    for (const feature of features) {
      void client.status(feature, signal).then(
        (status) => {
          if (!signal.aborted)
            setStatuses((current) => ({ ...current, [feature]: status }));
        },
        () => {
          if (!signal.aborted) {
            setStatuses((current) => ({ ...current, [feature]: undefined }));
            setStatusErrors((current) => ({
              ...current,
              [feature]: "Connection status unavailable. Check again.",
            }));
          }
        },
      );
    }
    return () => statusRequests.abort();
  }, [client, refresh, statusRequests]);

  const calendarConnected = statuses.calendar?.connected === true;
  // biome-ignore lint/correctness/useExhaustiveDependencies: A publish or manual refresh restarts polling after its terminal result.
  useEffect(() => {
    if (!calendarConnected) return;
    const signal = publicationRequests.restart();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    async function poll() {
      try {
        const result = await client.publications(signal);
        if (signal.aborted) return;
        failures = 0;
        setPublicationError(false);
        setPublications(result);
        if (
          result.some(
            (item) => item.status === "pending" || item.status === "processing",
          )
        )
          timeout = setTimeout(() => void poll(), 3000);
      } catch {
        if (signal.aborted) return;
        setPublicationError(true);
        failures += 1;
        if (failures < 3) timeout = setTimeout(() => void poll(), 5000);
      }
    }
    void poll();
    return () => {
      publicationRequests.abort();
      clearTimeout(timeout);
    };
  }, [client, calendarConnected, publicationRefresh, publicationRequests]);

  async function run(
    feature: GoogleIntegration,
    action: "connect" | "disconnect" | "export" | "publish",
  ) {
    if (actionInFlight.current) return;
    const signal = actions.restart();
    actionInFlight.current = true;
    setBusy(feature);
    setError(null);
    setMessage(null);
    try {
      if (action === "connect") {
        const url = await client.connect(feature, signal);
        if (!signal.aborted) window.location.assign(url);
      } else if (action === "disconnect") {
        await client.disconnect(feature, signal);
        if (signal.aborted) return;
        setStatuses((current) => ({
          ...current,
          [feature]: {
            enabled: true,
            connected: false,
            reconnectRequired: false,
          },
        }));
        if (feature === "calendar") setPublications([]);
        setMessage(
          `${names[feature]} disconnected. Existing Google files and events are kept.`,
        );
        setRefresh((current) => current + 1);
      } else if (action === "export") {
        setExported(null);
        const result = await client.exportSessions(sessionIds, signal);
        if (!signal.aborted) setExported(result);
      } else {
        const result = await client.publishSessions(sessionIds, signal);
        if (signal.aborted) return;
        setMessage(
          `${result.queuedSessionCount} session${result.queuedSessionCount === 1 ? "" : "s"} queued for Google Calendar. Publication status appears below.`,
        );
        setPublicationRefresh((current) => current + 1);
      }
    } catch {
      if (signal.aborted) return;
      setError(
        action === "export"
          ? "Export could not be confirmed. Check Google Sheets before trying again; a spreadsheet may already have been created."
          : `${names[feature]} could not finish this request. Check your connection and try again.`,
      );
      setRefresh((current) => current + 1);
    } finally {
      actionInFlight.current = false;
      if (!signal.aborted) setBusy(null);
    }
  }

  const visiblePublications = publications.flatMap((publication) => {
    const session = sessions.find((item) => item.id === publication.sessionId);
    return session ? [{ ...publication, intention: session.intention }] : [];
  });
  return (
    <section
      className="focus-card focus-google"
      aria-labelledby="focus-google-heading"
    >
      <div className="focus-section-heading">
        <h2 id="focus-google-heading">Share completed sessions</h2>
        <button
          className="focus-text-button"
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setRefresh((current) => current + 1);
            setPublicationRefresh((current) => current + 1);
          }}
        >
          Check status
        </button>
      </div>
      <p>
        Select saved, completed sessions in your history below. Export their
        intentions, times, focused duration, and recaps to Sheets or the Focus
        Timer calendar. Calendar events span the session from start to finish,
        including pauses, and do not block your availability.
      </p>
      <p className="focus-muted">{sessionIds.length} selected</p>
      <div className="focus-google-connections">
        {features.map((feature) => {
          const status = statuses[feature];
          const connected = status?.connected && !status.reconnectRequired;
          return (
            <div className="focus-google-connection" key={feature}>
              <h3>{names[feature]}</h3>
              <p role="status">
                {statusErrors[feature] ??
                  (!status
                    ? "Checking connection…"
                    : !status.enabled
                      ? "Not configured for this installation"
                      : status.reconnectRequired
                        ? "Reconnect to continue"
                        : connected
                          ? "Connected"
                          : "Not connected")}
              </p>
              <div className="focus-actions">
                {status?.enabled && !connected && (
                  <button
                    className="timer-button"
                    disabled={busy !== null}
                    type="button"
                    onClick={() => void run(feature, "connect")}
                  >
                    {busy === feature
                      ? "Please wait…"
                      : status.reconnectRequired
                        ? "Reconnect"
                        : "Connect"}
                  </button>
                )}
                {connected && (
                  <button
                    className="timer-button"
                    type="button"
                    disabled={
                      busy !== null ||
                      sessionIds.length === 0 ||
                      sessionIds.length > 500
                    }
                    onClick={() =>
                      void run(
                        feature,
                        feature === "sheets" ? "export" : "publish",
                      )
                    }
                  >
                    {busy === feature
                      ? "Please wait…"
                      : feature === "sheets"
                        ? "Export to Sheets"
                        : "Publish to Calendar"}
                  </button>
                )}
                {(status?.connected || status?.reconnectRequired) && (
                  <button
                    className="focus-text-button"
                    disabled={busy !== null}
                    type="button"
                    onClick={() => void run(feature, "disconnect")}
                  >
                    Disconnect
                  </button>
                )}
              </div>
              <small>
                {feature === "sheets"
                  ? "Each export creates a new spreadsheet."
                  : "Each session is published once. Publishing again retries failures without duplicating events. Later edits are not synced."}
              </small>
            </div>
          );
        })}
      </div>
      {sessionIds.length > 500 && (
        <p role="alert">Select up to 500 sessions at a time.</p>
      )}
      {error && (
        <p className="assistant-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {exported && (
        <p role="status">
          Exported {exported.exportedSessionCount} session
          {exported.exportedSessionCount === 1 ? "" : "s"}.{" "}
          <a
            className="focus-text-button"
            href={exported.spreadsheetUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open spreadsheet
          </a>
        </p>
      )}
      {publicationError && (
        <p role="alert" className="assistant-error">
          Calendar publication status could not be refreshed. Use Check status
          to try again.
        </p>
      )}
      {visiblePublications.length > 0 && (
        <div aria-live="polite">
          <h3>Calendar publications</h3>
          <ul className="focus-google-publications">
            {visiblePublications.map((item) => (
              <li key={item.sessionId}>
                <span>{item.intention}</span>
                <span>
                  {item.status === "completed"
                    ? "Published"
                    : item.status === "dead"
                      ? "Failed — reconnect if needed, then select and publish again"
                      : "Queued — publishing…"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
