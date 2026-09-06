"use client";

import type { ApiClient } from "@repo/api-client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { env } from "../env";
import {
  errorMessage,
  formatDuration,
  type FocusDetail,
  type FocusSession,
} from "./focus-state";

export function SessionDetail({
  api,
  session,
  pending,
}: {
  api: ApiClient;
  session: FocusSession;
  pending: boolean;
}) {
  const [detail, setDetail] = useState<FocusDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ text: string; revision: number } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const noteAttempt = useRef<{
    signature: string;
    id: string;
    occurredAt: string;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  const sectionEventIds = new Set(
    detail?.segments.flatMap((segment) =>
      segment.events.map((event) => event.id),
    ),
  );
  const outsideEvents =
    detail?.events.filter((event) => !sectionEventIds.has(event.id)) ?? [];
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await api.focus.get(
          { sessionId: session.id },
          { signal },
        );
        if (!signal?.aborted) {
          setDetail(result);
          setFetchError(null);
        }
      } catch (cause) {
        if (!signal?.aborted) setFetchError(errorMessage(cause));
      }
    },
    [api, session.id],
  );
  useEffect(() => {
    if (pending) return;
    const controller = new AbortController();
    request.current = controller;
    // Fetch completion updates state asynchronously; this effect owns its cancellation.
    void refresh(controller.signal);
    const interval = setInterval(() => void refresh(controller.signal), 10_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [pending, refresh, session.revision]);

  async function saveRecap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.focus.updateRecap(
        {
          sessionId: session.id,
          text: draft.text,
          expectedRevision: draft.revision,
        },
        { signal: request.current?.signal },
      );
      setDetail(next);
      setDraft(null);
    } catch (cause) {
      setError(
        `${errorMessage(cause)} Your edit is still here. Cancel and reopen the editor to use the latest recap.`,
      );
    } finally {
      setSaving(false);
    }
  }
  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const signature = JSON.stringify([note.trim(), evidence.trim()]);
    if (noteAttempt.current?.signature !== signature)
      noteAttempt.current = {
        signature,
        id: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
      };
    try {
      const next = await api.focus.addNote(
        {
          sessionId: session.id,
          id: noteAttempt.current.id,
          occurredAt: noteAttempt.current.occurredAt,
          summary: note.trim(),
          ...(evidence.trim() ? { evidenceUrl: evidence.trim() } : {}),
        },
        { signal: request.current?.signal },
      );
      setDetail(next);
      setNote("");
      setEvidence("");
      noteAttempt.current = null;
    } catch (cause) {
      setError(
        `${errorMessage(cause)} Your note has not been cleared; retry to confirm it was saved.`,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      {pending && (
        <p className="focus-notice">
          Recap and capture settings will refresh after your timer actions sync.
        </p>
      )}
      {(error || fetchError) && (
        <p role="alert" className="assistant-error">
          {error ?? fetchError}
        </p>
      )}
      {detail && (
        <>
          <section className="focus-card">
            <div className="focus-section-heading">
              <h2>Your recap</h2>
              {!draft && (
                <button
                  className="focus-text-button"
                  disabled={pending}
                  onClick={() =>
                    setDraft({
                      text: (
                        detail.session.recapText ?? detail.generatedRecap
                      ).slice(0, 8000),
                      revision: detail.session.recapRevision,
                    })
                  }
                >
                  Edit recap
                </button>
              )}
            </div>
            {draft ? (
              <form className="focus-form" onSubmit={saveRecap}>
                <label htmlFor="focus-recap">
                  What did you focus on and get done?
                </label>
                <textarea
                  id="focus-recap"
                  rows={9}
                  maxLength={8000}
                  value={draft.text}
                  onChange={(event) =>
                    setDraft({ ...draft, text: event.target.value })
                  }
                />
                <small>
                  Up to 8,000 characters. Your edits are saved separately from
                  the activity record.
                </small>
                <div className="focus-actions">
                  <button
                    className="timer-button timer-button--primary"
                    disabled={saving || pending}
                  >
                    Save recap
                  </button>
                  <button
                    type="button"
                    className="timer-button"
                    disabled={saving}
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="focus-recap">
                  {detail.session.recapText ?? detail.generatedRecap}
                </p>
                <small>
                  {detail.session.recapText === null
                    ? "Built from recorded activity. Agent reports are claims, not verified outcomes."
                    : "Your edited recap. Recorded evidence remains below."}
                </small>
              </>
            )}
          </section>
          <section className="focus-card">
            <h2>15 minutes at a time</h2>
            <p>
              Sections count focused time and exclude pauses. Empty sections
              mean no activity was recorded.
            </p>
            {detail.segmentsTruncated && (
              <p className="focus-notice">
                Showing the first 7 days of focus sections.
              </p>
            )}
            {detail.segments.length ? (
              detail.segments.map((segment) => (
                <details className="focus-segment" key={segment.index}>
                  <summary>
                    {formatDuration(segment.startOffsetMs)}–
                    {formatDuration(segment.endOffsetMs)}{" "}
                    <span>
                      {segment.events.length} event
                      {segment.events.length === 1 ? "" : "s"}
                    </span>
                  </summary>
                  <EventList events={segment.events} />
                </details>
              ))
            ) : (
              <p>No focused time recorded yet.</p>
            )}
            {outsideEvents.length > 0 && (
              <details className="focus-segment">
                <summary>Outside the focused sections</summary>
                <EventList events={outsideEvents} />
              </details>
            )}
          </section>
          <section className="focus-card">
            <h2>Add what matters</h2>
            <form className="focus-form" onSubmit={addNote}>
              <label htmlFor="focus-note">
                Progress, outcome, or something to revisit
              </label>
              <textarea
                id="focus-note"
                rows={3}
                required
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <label htmlFor="focus-evidence">
                Evidence link (optional, HTTPS)
              </label>
              <input
                id="focus-evidence"
                type="url"
                pattern="https://.*"
                maxLength={2048}
                placeholder="https://github.com/…"
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
              />
              <button
                className="timer-button"
                disabled={saving || pending || !note.trim()}
              >
                Save note
              </button>
            </form>
          </section>
        </>
      )}
      <CaptureSettings api={api} sessionId={session.id} disabled={pending} />
    </>
  );
}

function EventList({ events }: { events: FocusDetail["events"] }) {
  return events.length ? (
    <ul className="focus-events">
      {events.map((event) => (
        <li key={event.id}>
          <div>
            <span className="focus-source">
              {event.source === "manual"
                ? "Your note"
                : event.kind === "turn_completed"
                  ? "Codex · agent reported"
                  : "Codex · tool event"}
            </span>
            <time dateTime={event.occurredAt}>
              {new Date(event.occurredAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>
          <p>{event.summary}</p>
          {event.evidenceUrl && event.evidenceUrl.startsWith("https://") && (
            <a href={event.evidenceUrl} target="_blank" rel="noreferrer">
              View evidence ↗
            </a>
          )}
        </li>
      ))}
    </ul>
  ) : (
    <p className="focus-muted">No recorded activity in this section.</p>
  );
}

function CaptureSettings({
  api,
  sessionId,
  disabled,
}: {
  api: ApiClient;
  sessionId: string;
  disabled: boolean;
}) {
  const [consent, setConsent] = useState(false);
  const [shareSummary, setShareSummary] = useState(false);
  const [token, setToken] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = JSON.stringify(
    {
      apiOrigin: env.NEXT_PUBLIC_API_URL,
      sessionId,
      shareAssistantSummary: shareSummary,
    },
    null,
    2,
  );
  const setup = `node integrations/codex/timer-capture.mjs configure <<'TIMER_CONFIG'\n${config}\nTIMER_CONFIG\nread -r -s TIMER_CAPTURE_TOKEN\nexport TIMER_CAPTURE_TOKEN\ncodex`;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied.");
    } catch {
      setError("Copy was unavailable. Select and copy the text manually.");
    }
  }
  return (
    <section className="focus-card">
      <details>
        <summary className="focus-connect-heading">
          Connect Codex activity
        </summary>
        <p>
          Opt in to send selected events to this session. By default, the
          adapter sends event metadata without raw commands, terminal output,
          transcripts, or screenshots.
        </p>
        <label className="focus-check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          I want to send selected Codex events to this session.
        </label>
        <label className="focus-check">
          <input
            type="checkbox"
            checked={shareSummary}
            onChange={(event) => setShareSummary(event.target.checked)}
          />
          Also share bounded assistant-message excerpts. These may contain
          details about my work and are labeled as agent reports.
        </label>
        <p>
          <small>
            Changing these boxes changes the setup instructions. To change an
            installed adapter, run configuration again; to stop uploads
            immediately, revoke access below.
          </small>
        </p>
        <div className="focus-actions">
          <button
            className="timer-button"
            disabled={!consent || busy || disabled}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setToken(await api.focus.createCaptureToken({ sessionId }));
                setMessage(
                  "New token created. Copy it now; it is shown only here. Previous tokens for this session are replaced.",
                );
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create capture token
          </button>
          <button
            className="focus-text-button"
            disabled={busy || disabled}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.focus.revokeCaptureToken({ sessionId });
                setToken(null);
                setMessage("Capture access revoked for this session.");
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Revoke capture access
          </button>
        </div>
        {error && (
          <p className="assistant-error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {token && (
          <div className="focus-token">
            <label htmlFor="focus-capture-token">
              Capture token · expires{" "}
              {new Date(token.expiresAt).toLocaleString()}
            </label>
            <input
              id="focus-capture-token"
              readOnly
              value={token.token}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="focus-actions">
              <button
                className="timer-button"
                onClick={() => void copy(token.token)}
              >
                Copy token
              </button>
              <button
                className="focus-text-button"
                onClick={() => setToken(null)}
              >
                Hide token
              </button>
            </div>
          </div>
        )}
        <p>
          Session ID: <code>{sessionId}</code>
          <br />
          API origin: <code>{env.NEXT_PUBLIC_API_URL}</code>
        </p>
        <details>
          <summary>Setup instructions</summary>
          <ol>
            <li>
              From the Timer repository, merge{" "}
              <code>integrations/codex/hooks.example.json</code> into your Codex
              hooks, replacing the script path with its absolute location. See{" "}
              <code>integrations/codex/README.md</code> for the hook
              configuration.
            </li>
            <li>
              Run the configuration below. When <code>read</code> waits, paste
              the capture token and press Enter. The token stays out of shell
              history.
            </li>
            <li>
              Launch Codex in that same shell. Events appear here as the adapter
              uploads them.
            </li>
          </ol>
          <pre>{setup}</pre>
          <button className="timer-button" onClick={() => void copy(setup)}>
            Copy setup commands
          </button>
        </details>
      </details>
    </section>
  );
}
