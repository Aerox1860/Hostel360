import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, Card, Field, Page, AlertMessage, Brand } from "../ui";
import { User, useAuth } from "../state";

type GoogleId = {
  initialize: (options: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    auto_select?: boolean;
  }) => void;
  renderButton: (element: HTMLElement, options: {
    theme: "outline";
    size: "large";
    text: "continue_with";
    shape: "rectangular";
    width: number;
  }) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

function GoogleButton({ onToken }: { onToken: (token: string) => Promise<void> }) {
  const element = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  const [error, setError] = useState("");
  const enabled = import.meta.env.VITE_GOOGLE_DIRECT_SIGNIN_ENABLED === "true";
  const clientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || "";

  useEffect(() => { callback.current = onToken; }, [onToken]);

  useEffect(() => {
    if (!enabled || !clientId || !element.current) return;
    let active = true;
    const render = () => {
      const googleId = window.google?.accounts?.id;
      if (!active || !googleId || !element.current) {
        if (active) setError("Google Sign-In could not be initialized.");
        return;
      }
      googleId.initialize({
        client_id: clientId,
        auto_select: false,
        callback: (response) => {
          if (!response.credential) {
            setError("Google did not return an ID token.");
            return;
          }
          void callback.current(response.credential).catch((reason) => {
            setError(reason instanceof Error ? reason.message : "Google Sign-In failed.");
          });
        },
      });
      googleId.renderButton(element.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width: Math.min(380, Math.max(240, element.current.clientWidth)),
      });
    };
    const script = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
      || document.createElement("script");
    const alreadyLoaded = Boolean(window.google?.accounts?.id);
    const onLoad = () => render();
    const onError = () => setError("Unable to load Google Sign-In. Check your connection and try again.");
    if (!alreadyLoaded) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", onLoad, { once: true });
      script.addEventListener("error", onError, { once: true });
      if (!script.isConnected) document.head.appendChild(script);
    } else render();
    return () => {
      active = false;
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      element.current?.replaceChildren();
    };
  }, [enabled, clientId]);

  if (enabled && clientId) {
    return <><div className="google-render-target" ref={element} />{error && <AlertMessage tone="error">{error}</AlertMessage>}</>;
  }
  return (
    <>
      <button className="google-button" type="button" onClick={() => setError("Google Sign-In is not configured for this web origin.")}>
        <img src="/google-g.png" alt="" /> Continue with Google
      </button>
      {error && <AlertMessage tone="error">{error}</AlertMessage>}
    </>
  );
}

function AuthScaffold({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="auth-page">
      <section className="auth-intro">
        <Brand />
        <h1>Manage and discover hostels, all in one place.</h1>
        <p className="muted">Hostel360 brings hostel owners and residents together.</p>
      </section>
      <main className="auth-form-wrap">
        <Card className="auth-card">
          <Brand />
          <h1>{title}</h1>
          {children}
        </Card>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { login, loginWithGoogleToken, linkPendingGoogleAccount, googleLinkPending, error: sessionError, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const propertyId = new URLSearchParams(location.search).get("propertyId");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const next = (user: User) => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(user.must_change_password ? "/change-password" : user.role === "admin" ? "/admin" : user.role === "owner" ? "/owner" : propertyId ? `/hostel/${encodeURIComponent(propertyId)}` : from || "/tenant", { replace: true });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const user = await login(email.trim(), password);
      if (googleLinkPending && !user.must_change_password) {
        try { await linkPendingGoogleAccount(); }
        catch (reason) {
          window.alert(`Signed in, but Google could not be linked: ${reason instanceof Error ? reason.message : "Please try again later."}`);
        }
      }
      next(user);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Login failed."); }
    finally { setBusy(false); }
  };
  return (
    <AuthScaffold title="Sign in">
      <form className="form" onSubmit={(event) => void submit(event)}>
        {sessionError && <><AlertMessage tone="error">Could not restore your previous session: {sessionError}</AlertMessage><Button kind="secondary" onClick={() => void refresh()}>Retry session</Button></>}
        <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="you@example.com" required />
        <Field label="Password" value={password} onChange={setPassword} type="password" required />
        {googleLinkPending && <AlertMessage tone="info">Sign in with the password for the account you want to link to this Google account.</AlertMessage>}
        {error && <AlertMessage tone="error">{error}</AlertMessage>}
        <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</Button>
      </form>
      <div className="divider">or</div>
      <GoogleButton onToken={async (token) => next(await loginWithGoogleToken(token, propertyId || undefined))} />
      <p className="muted">New here? <Link to={`/register${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ""}`}>Create an account</Link></p>
      <Link to="/">Back to Explore</Link>
    </AuthScaffold>
  );
}

export function RegisterPage() {
  const { register, loginWithGoogleToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const propertyId = params.get("propertyId");
  const [role, setRole] = useState<"tenant" | "owner">(params.get("role") === "owner" ? "owner" : "tenant");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [referral, setReferral] = useState((params.get("ref") || "").toUpperCase());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const next = (user: User) => navigate(user.must_change_password ? "/change-password" : user.role === "owner" ? "/owner" : user.role === "admin" ? "/admin" : propertyId ? `/hostel/${encodeURIComponent(propertyId)}` : "/tenant", { replace: true });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      setError("Fill in all required fields.");
      return;
    }
    if (mobile.trim() && !/^[6-9]\d{9}$/.test(mobile.trim())) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      next(await register({
        name: name.trim(),
        email: email.trim(),
        mobile,
        password,
        role,
        ...(role === "owner" && referral.trim() ? { referral_code: referral.trim().toUpperCase() } : {}),
      }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Registration failed."); }
    finally { setBusy(false); }
  };
  return (
    <AuthScaffold title="Create account">
      <form className="form" onSubmit={(event) => void submit(event)}>
        <Field label="I am a" value={role} onChange={(value) => setRole(value as "tenant" | "owner")} options={["tenant", "owner"]} />
        <Field label="Full name" value={name} onChange={setName} placeholder="Enter your full name" required />
        <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="you@example.com" required />
        <Field label="Mobile Number" value={mobile} onChange={setMobile} type="tel" placeholder="Enter your mobile number" maxLength={10} />
        {role === "owner" && <Field label="Referral code (optional)" value={referral} onChange={setReferral} />}
        <Field label="Password" value={password} onChange={setPassword} type="password" placeholder="Min 6 characters" required />
        {error && <AlertMessage tone="error">{error}</AlertMessage>}
        <Button type="submit" disabled={busy}>{busy ? "Creating account…" : "Create Account"}</Button>
      </form>
      <GoogleButton onToken={async (token) => next(await loginWithGoogleToken(token, propertyId || undefined))} />
      <p className="muted">Already have an account? <Link to={`/login${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ""}`}>Sign in</Link></p>
    </AuthScaffold>
  );
}

export function ChangePasswordPage() {
  const { changePassword, linkPendingGoogleAccount, googleLinkPending, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!current || nextPassword.length < 8 || nextPassword.length > 72) {
      setError("Use a new password between 8 and 72 characters.");
      return;
    }
    if (nextPassword !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const user = await changePassword(current, nextPassword);
      if (googleLinkPending) {
        try { await linkPendingGoogleAccount(); }
        catch (reason) {
          window.alert(`Password updated, but Google could not be linked: ${reason instanceof Error ? reason.message : "Please try again later."}`);
        }
      }
      navigate(user.role === "owner" ? "/owner" : user.role === "admin" ? "/admin" : "/tenant", { replace: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update password."); }
    finally { setBusy(false); }
  };
  return (
    <AuthScaffold title="Set a new password">
      <p className="muted">For your security, change your temporary password before continuing.</p>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <Field label="Current temporary password" value={current} onChange={setCurrent} type="password" required />
        <Field label="New password" value={nextPassword} onChange={setNextPassword} type="password" required />
        <Field label="Confirm new password" value={confirm} onChange={setConfirm} type="password" required />
        {error && <AlertMessage tone="error">{error}</AlertMessage>}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</Button>
        <Button kind="ghost" onClick={logout}>Log out</Button>
      </form>
    </AuthScaffold>
  );
}

export function AccountPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return <Page title="Account"><Card className="stack"><p>Sign in to manage your hostel, view rent, or save favorite stays.</p><div className="row"><Button onClick={() => navigate("/login")}>Sign In</Button><Button kind="secondary" onClick={() => navigate("/register")}>Create Account</Button></div></Card></Page>;
  return <Page title="Account" subtitle={user.role}>
    <Card className="stack"><h2>{user.name || "User"}</h2><p>{user.email}</p>
      <div className="row"><Button onClick={() => navigate(user.role === "admin" ? "/admin" : user.role === "owner" ? "/owner" : "/tenant")}>Go to my dashboard</Button>
        {user.role === "tenant" && <Button kind="secondary" onClick={() => navigate("/tenant/history-sharing")}>Global history sharing</Button>}
        <Button kind="ghost" onClick={() => navigate("/")}>Browse hostels</Button><Button kind="ghost" onClick={logout}>Log out</Button></div>
    </Card>
  </Page>;
}
