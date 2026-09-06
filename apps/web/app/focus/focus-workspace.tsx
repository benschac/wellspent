"use client";

import type { ApiClient } from "@repo/api-client";
import { useEffect, useState, type FormEvent } from "react";
import { elapsedAt, errorMessage, formatDuration } from "./focus-state";
import { SessionDetail } from "./session-detail";
import { useFocusSessions } from "./use-focus-sessions";

export function FocusWorkspace({
  api,
  userId,
  email,
  onSignOut,
}: {
  api: ApiClient;
  userId: string;
  email: string;
  onSignOut: () => Promise<void>;
}) {
  const focus = useFocusSessions(api, userId);
  const [intention, setIntention] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          >
            Start focusing
          </button>
        </form>
      )}
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
              >
                {formatDuration(elapsedAt(selected, now))}
              </div>
              {selected.status !== "completed" && (
                <div className="focus-actions">
                  <button
                    className="timer-button timer-button--primary"
                    disabled={focus.blocked || !focus.ready}
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
            />
          </div>
        )}
      </div>
    </>
  );
}
