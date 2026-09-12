"use client";

import {
  createApiClient,
  createGoogleIntegrationsClient,
} from "@repo/api-client";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { type FormEvent, useEffect, useState } from "react";
import { env } from "../env";
import { WorkLogWorkspace } from "../work-log/work-log-workspace";
import { errorMessage } from "./focus-state";
import { FocusWorkspace } from "./focus-workspace";

let browserSupabase: SupabaseClient | null = null;

function configuredSupabase() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (typeof window === "undefined") {
    // Rendering never authenticates on the server or shares a user's session.
    return createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  // React Strict Mode may invoke state initializers twice. Both renders must use
  // the same browser auth owner and refresh lock.
  browserSupabase ??= createClient(url, key);
  return browserSupabase;
}

export function FocusClient({
  view = "focus",
}: {
  view?: "focus" | "work-log";
}) {
  const [supabase] = useState(configuredSupabase);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) {
        setSession(next);
        setLoading(false);
      }
    });
    // INITIAL_SESSION comes from the SDK after persisted auth is initialized.
    void supabase.auth
      .getSession()
      .then(({ error: authError }) => {
        if (active && authError) {
          setError(authError.message);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(errorMessage(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  if (!supabase)
    return (
      <section className="focus-card">
        <h2>Your account is almost ready</h2>
        <p>
          Account sign-in hasn’t been configured for this installation yet. Ask
          the owner to connect Supabase Auth.
        </p>
      </section>
    );
  if (loading) return <p role="status">Opening your account…</p>;
  return (
    <>
      {error && (
        <p role="alert" className="assistant-error">
          {error}
        </p>
      )}
      {session ? (
        <AuthenticatedFocus
          key={session.user.id}
          supabase={supabase}
          session={session}
          view={view}
        />
      ) : (
        <AuthForm supabase={supabase} view={view} />
      )}
    </>
  );
}

function AuthenticatedFocus({
  supabase,
  session,
  view,
}: {
  supabase: SupabaseClient;
  session: Session;
  view: "focus" | "work-log";
}) {
  const [clients] = useState(() => {
    const options = {
      getAccessToken: async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session || data.session.user.id !== session.user.id)
          throw new Error("Sign in again to sync this account.");
        return data.session.access_token;
      },
    };
    return {
      api: createApiClient(env.NEXT_PUBLIC_API_URL, options),
      google: createGoogleIntegrationsClient(env.NEXT_PUBLIC_API_URL, options),
    };
  });
  if (view === "work-log") {
    return (
      <WorkLogWorkspace
        api={clients.api}
        email={session.user.email ?? "Your account"}
        onSignOut={async () => {
          const { error } = await supabase.auth.signOut({ scope: "local" });
          if (error) throw error;
        }}
      />
    );
  }
  return (
    <FocusWorkspace
      supabase={supabase}
      api={clients.api}
      google={clients.google}
      userId={session.user.id}
      email={session.user.email ?? "Your account"}
      onSignOut={async () => {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      }}
    />
  );
}

function AuthForm({
  supabase,
  view,
}: {
  supabase: SupabaseClient;
  view: "focus" | "work-log";
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result =
        mode === "signup"
          ? await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: `${window.location.origin}/${view}` },
            })
          : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session)
        setMessage(
          "Check your email to confirm your account, then return here to sign in.",
        );
      setPassword("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="focus-card focus-auth">
      <h2>
        {mode === "signin"
          ? view === "work-log"
            ? "Your work, in one place"
            : "Your focus, in one place"
          : "Create your account"}
      </h2>
      <p>
        {view === "work-log"
          ? "Sign in to connect your CLI or agent and keep a history of your work. No timer session required."
          : "Save sessions and connect selected CLI activity to see what you worked on."}
      </p>
      <form className="focus-form" onSubmit={submit}>
        <label htmlFor="focus-email">Email</label>
        <input
          id="focus-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="focus-password">Password</label>
        <input
          id="focus-password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p role="alert" className="assistant-error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button
          className="timer-button timer-button--primary"
          disabled={busy}
          type="submit"
        >
          {busy
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
        <button
          className="focus-text-button"
          type="button"
          disabled={busy}
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setMessage(null);
          }}
        >
          {mode === "signin"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </section>
  );
}
