"use client";

import type { ApiClient } from "@repo/api-client";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { env } from "../env";
import { errorMessage } from "../focus/focus-state";

type History = Awaited<ReturnType<ApiClient["workLog"]["list"]>>;
type Tokens = Awaited<ReturnType<ApiClient["workLog"]["listTokens"]>>;
type NewToken = Awaited<ReturnType<ApiClient["workLog"]["createToken"]>>;

export function WorkLogWorkspace({
  api,
  email,
  onSignOut,
}: {
  api: ApiClient;
  email: string;
  onSignOut: () => Promise<void>;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [tokens, setTokens] = useState<Tokens>([]);
  const [newToken, setNewToken] = useState<NewToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef(0);
  const request = useRef(0);
  const tokenRequest = useRef(0);

  const load = useCallback(
    async (before?: NonNullable<History["nextCursor"]>) => {
      const generation = lifetime.current;
      const currentRequest = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const result = await api.workLog.list({
          limit: 30,
          ...(before ? { before } : {}),
        });
        if (
          generation !== lifetime.current ||
          currentRequest !== request.current
        )
          return;
        setHistory((previous) => ({
          ...result,
          entries:
            before && previous
              ? [
                  ...previous.entries,
                  ...result.entries.filter(
                    (entry) =>
                      !previous.entries.some(
                        (existing) => existing.id === entry.id,
                      ),
                  ),
                ]
              : result.entries,
        }));
      } catch (cause) {
        if (
          generation === lifetime.current &&
          currentRequest === request.current
        )
          setError(errorMessage(cause));
      } finally {
        if (
          generation === lifetime.current &&
          currentRequest === request.current
        )
          setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    const generation = lifetime.current;
    const currentTokenRequest = ++tokenRequest.current;
    void load();
    void api.workLog
      .listTokens()
      .then((result) => {
        if (
          generation === lifetime.current &&
          currentTokenRequest === tokenRequest.current
        )
          setTokens(result);
      })
      .catch((cause: unknown) => {
        if (
          generation === lifetime.current &&
          currentTokenRequest === tokenRequest.current
        )
          setError(errorMessage(cause));
      });
    return () => {
      lifetime.current += 1;
    };
  }, [api, load]);

  async function tokenAction(action: () => Promise<void>) {
    const generation = lifetime.current;
    setBusy(true);
    setError(null);
    try {
      await action();
      if (generation !== lifetime.current) return;
      const currentTokenRequest = ++tokenRequest.current;
      const result = await api.workLog.listTokens();
      if (
        generation === lifetime.current &&
        currentTokenRequest === tokenRequest.current
      )
        setTokens(result);
    } catch (cause) {
      if (generation === lifetime.current) setError(errorMessage(cause));
    } finally {
      if (generation === lifetime.current) setBusy(false);
    }
  }

  function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const generation = lifetime.current;
    void tokenAction(async () => {
      const result = await api.workLog.createToken({ label: label.trim() });
      if (generation === lifetime.current) {
        setNewToken(result);
        setCopied(false);
        setLabel("");
      }
    });
  }

  return (
    <>
      <div className="focus-account">
        <span>{email}</span>
        <button
          className="focus-text-button"
          type="button"
          disabled={busy}
          onClick={() => {
            const generation = lifetime.current;
            setBusy(true);
            void onSignOut().catch((cause: unknown) => {
              if (generation === lifetime.current) {
                setError(errorMessage(cause));
                setBusy(false);
              }
            });
          }}
        >
          Sign out
        </button>
      </div>
      {error && (
        <p role="alert" className="assistant-error">
          {error}
        </p>
      )}
      <section className="focus-card">
        <div className="focus-section-heading">
          <h2>Recent work</h2>
          <button
            className="focus-text-button"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
        <p className="focus-muted">
          Newest activity first. Timestamps are UTC. Activity records describe
          logged work, not measured focus time.
        </p>
        {loading && <p role="status">Loading work…</p>}
        {history?.entries.length === 0 && (
          <p>
            No work logged yet. Connect your CLI below to add your first entry.
          </p>
        )}
        <ul className="focus-events">
          {history?.entries.map((entry) => (
            <li key={entry.id}>
              <p className="focus-recap">{entry.summary}</p>
              <small>
                <time dateTime={entry.occurredAt}>{entry.occurredAt}</time> ·{" "}
                {entry.source} · {entry.kind.replaceAll("_", " ")}
                {entry.project ? ` · ${entry.project}` : ""}
              </small>
              <p className="focus-muted">
                Thread: {entry.sourceSessionId}
                {entry.sessionId ? ` · Focus session: ${entry.sessionId}` : ""}
              </p>
            </li>
          ))}
        </ul>
        {history?.nextCursor && (
          <button
            className="focus-text-button"
            type="button"
            disabled={loading}
            onClick={() => {
              if (history.nextCursor) void load(history.nextCursor);
            }}
          >
            Load older entries
          </button>
        )}
      </section>
      <section className="focus-card">
        <h2>Connect your CLI or agent</h2>
        <p>
          Create a token for your machine. It can add and read your account’s
          work log. Keep it private; revoke it here when you no longer need it.
        </p>
        <form className="focus-form" onSubmit={createToken}>
          <label htmlFor="work-log-token-label">Token label</label>
          <input
            id="work-log-token-label"
            required
            maxLength={100}
            placeholder="My laptop"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button
            type="submit"
            className="timer-button timer-button--primary"
            disabled={busy || !label.trim()}
          >
            Create token
          </button>
        </form>
        {newToken && (
          <div className="focus-token">
            <p role="status">
              Token created. Save it now; it is only available during this
              visit. Expires {newToken.expiresAt}.
            </p>
            <label htmlFor="work-log-new-token">
              New token (select to copy)
            </label>
            <input
              id="work-log-new-token"
              type="password"
              readOnly
              value={newToken.token}
              autoComplete="off"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="focus-text-button"
              onClick={() => {
                const generation = lifetime.current;
                if (!navigator.clipboard) {
                  setError(
                    "Clipboard access is unavailable. Select and copy the token from the field.",
                  );
                  return;
                }
                void navigator.clipboard
                  .writeText(newToken.token)
                  .then(() => {
                    if (generation === lifetime.current) setCopied(true);
                  })
                  .catch(() => {
                    if (generation === lifetime.current)
                      setError(
                        "Could not copy the token. Select and copy it from the field.",
                      );
                  });
              }}
            >
              {copied ? "Copied" : "Copy token"}
            </button>
            <button
              type="button"
              className="focus-text-button"
              onClick={() => setNewToken(null)}
            >
              Dismiss token
            </button>
          </div>
        )}
        <p>
          Set <code>TIMER_WORK_LOG_TOKEN</code> in your terminal environment,
          then run from the Timer checkout:
        </p>
        <pre style={{ overflowX: "auto" }}>
          <code>bun integrations/work-log/cli.mjs configure</code>
        </pre>
        <p>Pass this JSON on standard input:</p>
        <pre style={{ overflowX: "auto" }}>
          <code>{JSON.stringify({ apiOrigin: env.NEXT_PUBLIC_API_URL })}</code>
        </pre>
        <p>
          Run <code>bun integrations/work-log/cli.mjs log</code> with JSON such
          as{" "}
          <code>
            {
              '{"summary":"Investigated authentication failures","project":"timer"}'
            }
          </code>{" "}
          on standard input. Use <code>list</code> to read recent work.
        </p>
        <ul className="focus-events">
          {tokens.map((token) => (
            <li key={token.id}>
              <p>{token.label}</p>
              <small>
                Created {token.createdAt} · Expires {token.expiresAt}
                {token.revokedAt ? " · Revoked" : ""}
              </small>
              {!token.revokedAt && (
                <div>
                  <button
                    type="button"
                    className="focus-text-button"
                    disabled={busy}
                    onClick={() => {
                      if (newToken?.id === token.id) setNewToken(null);
                      void tokenAction(async () => {
                        await api.workLog.revokeToken({ id: token.id });
                      });
                    }}
                  >
                    Revoke
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
