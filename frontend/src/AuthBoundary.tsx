import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { authConfigurationError, authEnabled, supabase } from "./auth";

export default function AuthBoundary({
  required,
  replay,
  children,
}: {
  required: boolean;
  replay: () => void;
  children: (session: Session | null) => ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(authEnabled);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }
    let active = true;
    let receivedEvent = false;
    setLoading(true);
    setError("");
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      receivedEvent = true;
      setSession(next);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") setRecovery(false);
    });
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || receivedEvent) return;
        setLoading(false);
        if (error)
          setError("Could not restore your session. Please try again.");
        else setSession(data.session);
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          setError("Could not restore your session. Please try again.");
        }
      });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [retry]);

  if (!authEnabled) return children(null);
  if (recovery)
    return (
      <AuthPanel recovery done={() => setRecovery(false)} replay={replay} />
    );
  if (required) {
    if (authConfigurationError || error)
      return (
        <main className="auth-shell">
          <section className="auth-panel panel">
            <h1>Sign-in unavailable</h1>
            <p role="alert">{authConfigurationError || error}</p>
            <button
              className="outline-button"
              onClick={() => setRetry((v) => v + 1)}
            >
              Try again
            </button>
            <button className="outline-button" onClick={replay}>
              Explore NBA replay
            </button>
          </section>
        </main>
      );
    if (loading)
      return (
        <main className="auth-shell">
          <p role="status">Restoring your session…</p>
        </main>
      );
    if (!session) return <AuthPanel replay={replay} />;
  }
  return children(session);
}

function AuthPanel({
  replay,
  recovery = false,
  done,
}: {
  replay: () => void;
  recovery?: boolean;
  done?: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const title = recovery
    ? "Choose a new password"
    : mode === "signup"
      ? "Create your Courtside account"
      : mode === "reset"
        ? "Reset your password"
        : "Welcome to Courtside";
  const action = recovery
    ? "Update password"
    : mode === "signup"
      ? "Create account"
      : mode === "reset"
        ? "Send reset email"
        : "Sign in";

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      if (recovery) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        done?.();
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (error) throw error;
        setNotice(
          "If an account exists for this email, you’ll receive a password reset link.",
        );
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        setPassword("");
        if (!data.session)
          setNotice(
            "Check your email for a confirmation link, then sign in to continue.",
          );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setPassword("");
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? error.code : "";
      setError(
        code === "invalid_credentials"
          ? "The email or password is incorrect. Please try again."
          : code === "email_not_confirmed"
            ? "Confirm your email using the link in your inbox before signing in."
            : code === "over_request_rate_limit" ||
                code === "over_email_send_rate_limit"
              ? "Too many attempts. Please wait a minute before trying again."
              : "We couldn’t complete that request. Please try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel panel" aria-label="Account access">
        <span className="auth-brand">COURTSIDE</span>
        <h1>{title}</h1>
        <p>
          {recovery
            ? "Use at least 8 characters."
            : "Sign in for live NBA forecasts and your private forecast history."}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          {!recovery && (
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </label>
          )}
          {(recovery || mode !== "reset") && (
            <label>
              Password
              <input
                type="password"
                autoComplete={
                  recovery || mode === "signup"
                    ? "new-password"
                    : "current-password"
                }
                minLength={recovery || mode === "signup" ? 8 : undefined}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
          )}
          {error && (
            <p className="error-notice" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <button className="predict-button" type="submit" disabled={busy}>
            {busy ? "Please wait…" : action}
          </button>
        </form>
        {!recovery && (
          <div className="auth-actions">
            <button
              className="outline-button"
              disabled={busy}
              onClick={() => {
                setMode(mode === "signup" ? "signin" : "signup");
                setError("");
                setNotice("");
                setPassword("");
              }}
            >
              {mode === "signup"
                ? "Already have an account? Sign in"
                : "Create an account"}
            </button>
            <button
              className="outline-button"
              disabled={busy}
              onClick={() => {
                setMode(mode === "reset" ? "signin" : "reset");
                setError("");
                setNotice("");
                setPassword("");
              }}
            >
              {mode === "reset" ? "Back to sign in" : "Forgot password?"}
            </button>
            <button className="outline-button" onClick={replay} disabled={busy}>
              Explore NBA replay
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
