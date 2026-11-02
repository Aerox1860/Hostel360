import { FormEvent, ReactNode, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { User, useAuth } from "./state";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link className="brand" to="/" aria-label="Hostel 360 home">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
      {!small && <span className="brand-name">Hostel<span>360</span></span>}
    </Link>
  );
}

export function Button({
  children,
  kind = "primary",
  type = "button",
  disabled,
  onClick,
}: {
  children: ReactNode;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return <button className={`button ${kind}`} type={type} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Page({ title, subtitle, children, actions }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main className="page">
      <header className="page-heading">
        <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
  min,
  max,
  maxLength,
  multiline = false,
  options,
  optionLabels,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  multiline?: boolean;
  options?: string[];
  optionLabels?: Record<string, string>;
}) {
  return (
    <label className="field">
      <span>{label}{required ? " *" : ""}</span>
      {options ? (
        <select value={value} required={required} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select…</option>
          {options.map((option) => <option key={option} value={option}>{optionLabels?.[option] || option}</option>)}
        </select>
      ) : multiline ? (
        <textarea value={value} required={required} placeholder={placeholder} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input type={type} value={value} required={required} placeholder={placeholder} min={min} max={max} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

export function Form({
  children,
  onSubmit,
  className = "",
}: {
  children: ReactNode;
  onSubmit: () => Promise<void> | void;
  className?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await onSubmit();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={`form ${className}`} onSubmit={(event) => void submit(event)}>
      {children}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={busy}>{busy ? "Working…" : "Save"}</button>
    </form>
  );
}

export function AlertMessage({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "error" }) {
  return <div className={`alert ${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function DataTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-scroll">
      <table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const menus: Record<User["role"], { label: string; path: string }[]> = {
  owner: [
    { label: "Dashboard", path: "/owner" },
    { label: "Rooms & Beds", path: "/owner/rooms" },
    { label: "Tenants", path: "/owner/tenants" },
    { label: "Rent & Expenses", path: "/owner/money" },
    { label: "More", path: "/owner/more" },
    { label: "Refer & Earn", path: "/owner/referrals" },
  ],
  tenant: [
    { label: "Home", path: "/tenant" },
    { label: "Payments", path: "/tenant/payments" },
    { label: "Notices", path: "/tenant/notices" },
    { label: "Complaints & Requests", path: "/tenant/complaints" },
    { label: "History Sharing", path: "/tenant/history-sharing" },
  ],
  admin: [
    { label: "Dashboard", path: "/admin" },
    { label: "Hostels", path: "/admin/hostels" },
    { label: "Owners", path: "/admin/owners" },
    { label: "Plans", path: "/admin/plans" },
    { label: "Advertisements", path: "/admin/advertisements" },
    { label: "Referral settings", path: "/admin/referrals" },
  ],
};

export function ProtectedLayout({ role }: { role: User["role"] }) {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  if (loading) return <div className="centered">Loading your Hostel360 account…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.must_change_password && location.pathname !== "/change-password") return <Navigate to="/change-password" replace />;
  if (user.role !== role) return <Navigate to={user.role === "admin" ? "/admin" : user.role === "owner" ? "/owner" : "/tenant"} replace />;

  return (
    <div className="app-shell">
      <header className="topbar"><Brand /><div className="account-chip">{user.name || user.email}<Button kind="ghost" onClick={logout}>Log out</Button></div></header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-profile"><b>{user.name || user.email}</b><span>{role === "admin" ? "Administrator" : role === "owner" ? "Hostel owner" : "Tenant"}</span></div>
          <nav aria-label={`${role} navigation`}>
            {menus[role].map((item) => <Link key={item.path} className={location.pathname === item.path ? "active" : ""} to={item.path}>{item.label}</Link>)}
            {role === "owner" && <>
              <Link to="/owner/tenant-registration">Tenant registration</Link>
              <Link to="/owner/tenant-alerts">Alerts</Link>
              <Link to="/owner/rules">Rules & Regulations</Link>
            </>}
            {role === "tenant" && <>
              <Link to="/tenant/policy-review">Rules review</Link>
            </>}
          </nav>
          <button className="sidebar-logout" onClick={logout}>Log out</button>
        </aside>
        <div className="workspace-content"><Outlet /></div>
      </div>
    </div>
  );
}

export function useAction() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const run = async (action: () => Promise<unknown>, success?: string) => {
    setError("");
    setMessage("");
    try {
      await action();
      if (success) setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The request failed.");
    }
  };
  return {
    error: error && <AlertMessage tone="error">{error}</AlertMessage>,
    message: message && <AlertMessage tone="success">{message}</AlertMessage>,
    run,
    clear: () => { setError(""); setMessage(""); },
  };
}

export function ApiStatus() {
  const [text, setText] = useState("");
  const check = async () => {
    try {
      const result = await api.get<{ status: string }>("/healthz");
      setText(result.status);
    } catch (error) {
      setText(error instanceof Error ? error.message : "API unavailable");
    }
  };
  return <button className="quiet-link" onClick={() => void check()}>{text || "Check connection"}</button>;
}

export function useNavigateAfterLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  return (user: User) => {
    const propertyId = new URLSearchParams(location.search).get("propertyId");
    const destination = user.must_change_password
      ? "/change-password"
      : user.role === "admin"
        ? "/admin"
        : user.role === "owner"
          ? "/owner"
          : propertyId ? `/hostel/${encodeURIComponent(propertyId)}` : "/tenant";
    navigate(destination, { replace: true });
  };
}
