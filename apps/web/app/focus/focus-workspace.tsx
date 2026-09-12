"use client";

import type { ApiClient, GoogleIntegrationsClient } from "@repo/api-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type FormEvent, useEffect, useState } from "react";
import { elapsedAt, errorMessage, formatDuration } from "./focus-state";
import { googleEligibleSessionIds } from "./google-integration-state";
import { GoogleIntegrations } from "./google-integrations";
import { SessionDetail } from "./session-detail";
import { useFocusSessions } from "./use-focus-sessions";

export function FocusWorkspace({
  supabase,
  api,
  google,
  userId,
  email,
  onSignOut,
}: {
  supabase: SupabaseClient;
  api: ApiClient;
  google: GoogleIntegrationsClient;
  userId: string;
  email: string;
  onSignOut: () => Promise<void>;
}) {
  const focus = useFocusSessions(api, userId, supabase);
  const [intention, setIntention] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareIds, setShareIds] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleIds = googleEligibleSessionIds(focus.sessions, focus.pending);
  const selectedShareIds = Array.from(shareIds).filter((id) =>
    eligibleIds.has(id),
  );
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const activeSession = focus.sessions.find(
    (session) => session.status !== "completed",
  );
  const selected =
    focus.sessions.find((session) => session.id === selectedId) ??
    activeSession ??
    focus.sessions[0];
  const sessionPending =
    selected &&
    focus.pending.some(
      (command) =>
        (command.type === "create"
          ? command.input.id
          : command.input.sessionId) === selected.id,
    );
  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = crypto.randomUUID();
    if (
      focus.enqueue({
        type: "create",
        input: {
          id,
          commandId: crypto.randomUUID(),
          intention: intention.trim(),
          occurredAt: new Date().toISOString(),
        },
      })
    ) {
      setSelectedId(id);
      setIntention("");
    }
  }
  return (
    <>
      <div className="focus-account">
        <span>{email}</span>
        <button
          className="focus-text-button"
          disabled={signingOut}
          type="button"
          onClick={async () => {
            setSigningOut(true);
            try {
              await onSignOut();
            } catch (cause) {
              setError(errorMessage(cause));
              setSigningOut(false);
            }
          }}
        >
          Sign out
        </button>
      </div>
      {(error || focus.error) && (
        <p role="alert" className="assistant-error">
          {error ?? focus.error}
        </p>
      )}
      {focus.pending.length > 0 && (
        <p className="focus-notice" role="status">
          {focus.pending.length} timer action
          {focus.pending.length === 1 ? "" : "s"} waiting to sync. Kept on this
          browser if you reload or sign out.
        </p>
      )}
      {focus.blocked && (
        <div className="focus-actions">
          <button
            className="timer-button"
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Discard this browser’s pending timer actions for your account and use the saved server state? This cannot be undone.",
                )
              )
                void focus.discardPending();
            }}
          >
            Discard pending actions and use server state
          </button>
        </div>
      )}
      {!activeSession && (
        <form className="focus-card focus-form" onSubmit={start}>
          <h2>What will you focus on?</h2>
          <label htmlFor="focus-intention">Intention</label>
          <input
            id="focus-intention"
            placeholder="Make the login flow more reliable"
            maxLength={500}
            required
            value={intention}
            onChange={(event) => setIntention(event.target.value)}
          />
          <button
            className="timer-button timer-button--primary"
            disabled={!focus.ready || focus.blocked || !intention.trim()}
            type="submit"
          >
            Start focusing
          </button>
        </form>
      )}
      <GoogleIntegrations
        client={google}
        sessionIds={selectedShareIds}
        sessions={focus.sessions}
      />
      <div className="focus-columns">
        <aside className="focus-card focus-history">
          <h2>Your sessions</h2>
          {!focus.ready ? (
            <p role="status">Loading…</p>
          ) : !focus.sessions.length ? (
            <p>Your first session starts here.</p>
          ) : (
            <ul>
              {focus.sessions.map((session) => (
                <li key={session.id}>
                  <button
                    className={
                      selected?.id === session.id
                        ? "focus-session-link is-selected"
                        : "focus-session-link"
                    }
                    onClick={() => setSelectedId(session.id)}
                    aria-pressed={selected?.id === session.id}
                    type="button"
                  >
                    <strong>{session.intention}</strong>
                    <span>
                      {session.status} ·{" "}
                      {formatDuration(elapsedAt(session, now))}
                    </span>
                    <small>
                      {new Date(session.createdAt).toLocaleDateString()}
                    </small>
                  </button>
                  {session.status === "completed" && (
                    <label className="focus-check focus-share-check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${session.intention} for Google sharing`}
                        checked={
                          eligibleIds.has(session.id) &&
                          shareIds.has(session.id)
                        }
                        disabled={!eligibleIds.has(session.id)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setShareIds((current) => {
                            const next = new Set(current);
                            if (checked) next.add(session.id);
                            else next.delete(session.id);
                            return next;
                          });
                        }}
                      />
                      {eligibleIds.has(session.id)
                        ? "Select for sharing"
                        : "Waiting to sync"}
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
        {selected && (
          <div className="focus-session-content">
            <section className="focus-card">
              <p className="eyebrow">
                {selected.status === "completed"
                  ? "Session complete"
                  : selected.status === "paused"
                    ? "Taking a pause"
                    : "Focused time"}
              </p>
              <h2>{selected.intention}</h2>
              <div
                className="focus-clock"
                aria-label={`${Math.floor(elapsedAt(selected, now) / 60000)} minutes of focused time`}
                role="timer"
              >
                {formatDuration(elapsedAt(selected, now))}
              </div>
              {selected.status !== "completed" && (
                <div className="focus-actions">
                  <button
                    className="timer-button timer-button--primary"
                    disabled={focus.blocked || !focus.ready}
                    type="button"
                    onClick={() =>
                      focus.enqueue({
                        type: "transition",
                        input: {
                          sessionId: selected.id,
                          commandId: crypto.randomUUID(),
                          action:
                            selected.status === "running" ? "pause" : "resume",
                          expectedRevision: selected.revision,
                          occurredAt: new Date().toISOString(),
                        },
                      })
                    }
                  >
                    {selected.status === "running" ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="timer-button"
                    disabled={focus.blocked || !focus.ready}
                    type="button"
                    onClick={() =>
                      focus.enqueue({
                        type: "transition",
                        input: {
                          sessionId: selected.id,
                          commandId: crypto.randomUUID(),
                          action: "finish",
                          expectedRevision: selected.revision,
                          occurredAt: new Date().toISOString(),
                        },
                      })
                    }
                  >
                    Finish session
                  </button>
                </div>
              )}
            </section>
            <SessionDetail
              key={selected.id}
              api={api}
              session={selected}
              pending={!!sessionPending}
              refreshVersion={focus.refreshVersion}
            />
          </div>
        )}
      </div>
    </>
  );
}
