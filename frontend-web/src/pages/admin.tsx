import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AlertMessage, Button, Card, Field, Page } from "../ui";

type JsonRecord = Record<string, any>;

function ErrorBox({ error }: { error: string }) {
  return error ? <AlertMessage tone="error">{error}</AlertMessage> : null;
}

function AdminStatCard({ label, value, icon, tone }: { label: string; value: unknown; icon: string; tone: string }) {
  return <Card className="admin-stat-card">
    <span className={`admin-stat-icon ${tone}`} aria-hidden="true">{icon}</span>
    <span className="muted">{label}</span>
    <div className="stat">{String(value ?? "—")}</div>
  </Card>;
}

function AdminOverviewBars({ title, description, items }: { title: string; description: string; items: { label: string; value: number; tone: string }[] }) {
  const maximum = Math.max(1, ...items.map((item) => item.value));
  return <Card className="admin-chart-card stack">
    <div><h2>{title}</h2><p className="muted small">{description}</p></div>
    <div className="admin-chart-bars">
      {items.map((item) => <div className="admin-chart-row" key={item.label}>
        <div className="spread"><span>{item.label}</span><b>{item.value.toLocaleString("en-IN")}</b></div>
        <div className="admin-chart-track" role="img" aria-label={`${item.label}: ${item.value}`}>
          <span className={item.tone} style={{ width: `${Math.max(item.value ? 4 : 0, (item.value / maximum) * 100)}%` }} />
        </div>
      </div>)}
    </div>
  </Card>;
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<JsonRecord | null>(null);
  const [pending, setPending] = useState<JsonRecord[]>([]);
  const [plans, setPlans] = useState<JsonRecord[]>([]);
  const [plansError, setPlansError] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [dashboard, hostels] = await Promise.all([
        api.get<JsonRecord>("/admin/dashboard"),
        api.get<{ hostels: JsonRecord[] }>("/admin/hostels?status_filter=pending"),
      ]);
      setStats(dashboard); setPending(hostels.hostels); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load admin overview."); }
    try {
      const result = await api.get<{ plans: JsonRecord[] }>("/plans");
      setPlans(result.plans); setPlansError("");
    } catch (reason) { setPlansError(reason instanceof Error ? reason.message : "Could not load subscription plans."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const verify = async (id: string, action: string) => {
    setError("");
    try { await api.post(`/admin/hostels/${encodeURIComponent(id)}/verify`, { action, ...(action === "approve" ? { site_visit_status: "verified" } : {}) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update hostel verification."); }
  };
  const count = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return <Page title="Platform Overview" subtitle="Review platform activity and pending hostel listings" actions={<Button kind="secondary" onClick={() => void load()}>Refresh overview</Button>}>
    <ErrorBox error={error} />
    <section className="admin-hero">
      <div className="admin-hero-copy">
        <span className="admin-hero-eyebrow">GOLIVEHOSTEL360 · PLATFORM ADMIN</span>
        <h2>Manage a better hostel experience.</h2>
        <p>Your live view of platform growth, subscriptions, owners and verification activity.</p>
        <Link className="admin-hero-action" to="/admin/hostels">Review hostels <span aria-hidden="true">→</span></Link>
      </div>
      <svg className="admin-hero-art" viewBox="0 0 520 300" fill="none" aria-hidden="true">
        <path d="M37 263h460" stroke="#fff" strokeOpacity=".52" strokeWidth="2" />
        <path d="M70 263V133l73-45 74 45v130M202 263V96l94-59 94 59v167M369 263V145l62-38 62 38v118" fill="#0B1F44" stroke="#0B1F44" strokeLinejoin="round" strokeWidth="7" />
        <path d="M91 150h23v28H91zM151 121h24v30h-24zM116 197h28v66h-28zM229 118h31v34h-31zM325 112h31v39h-31zM229 171h31v38h-31zM325 174h31v89h-31zM390 163h25v32h-25zM451 161h24v35h-24zM405 215h29v48h-29z" fill="#8DE1DD" />
        <path d="m52 252 92-41 87 30 88-47 82 37 114-64v96H52Z" fill="#20A39E" fillOpacity=".42" />
        <path d="M203 83 296 25l96 59M366 131l65-40 65 40" stroke="#B8F4F0" strokeLinecap="round" strokeWidth="6" />
        <circle cx="430" cy="48" r="18" fill="#fff" fillOpacity=".2" />
        <circle cx="430" cy="48" r="9" fill="#fff" fillOpacity=".55" />
      </svg>
    </section>
    {stats && <>
      <div className="grid admin-stat-grid">
        <AdminStatCard label="Total hostels" value={stats.total_hostels} icon="⌂" tone="blue" />
        <AdminStatCard label="Total owners" value={stats.total_owners} icon="♙" tone="cyan" />
        <AdminStatCard label="Active owners" value={stats.active_owners} icon="✓" tone="green" />
        <AdminStatCard label="Inactive owners" value={stats.inactive_owners} icon="◷" tone="amber" />
        <AdminStatCard label="Premium plans" value={stats.premium_plans} icon="✦" tone="violet" />
        <AdminStatCard label="Total revenue" value={`₹${count(stats.total_revenue).toLocaleString("en-IN")}`} icon="₹" tone="blue" />
        <AdminStatCard label="Expired plans" value={stats.expired_plans} icon="↻" tone="rose" />
        <AdminStatCard label="New registrations" value={stats.new_registrations} icon="↗" tone="cyan" />
      </div>
      <div className="grid admin-overview-charts">
        <AdminOverviewBars title="Platform Growth" description="Live platform totals and recent registrations" items={[
          { label: "Hostels", value: count(stats.total_hostels), tone: "blue" },
          { label: "Owners", value: count(stats.total_owners), tone: "teal" },
          { label: "New registrations", value: count(stats.new_registrations), tone: "green" },
        ]} />
        <AdminOverviewBars title="Plan status" description="Current active and expired subscriptions" items={[
          { label: "Premium plans", value: count(stats.premium_plans), tone: "violet" },
          { label: "Expired plans", value: count(stats.expired_plans), tone: "rose" },
        ]} />
      </div>
    </>}
    <div className="grid admin-dashboard-bottom">
      <Card className="stack admin-pending-card">
        <div className="spread"><div><h2>Recent Activity</h2><p className="muted small">Hostel listings currently waiting for verification.</p></div><span className="badge warning">{pending.length} pending</span></div>
        <div className="admin-activity-list">
          {pending.slice(0, 4).map((hostel) => <article className="admin-activity-item" key={hostel.id}>
            <div className="admin-activity-row">
              <span className="admin-activity-marker" aria-hidden="true">⌂</span>
              <div className="admin-activity-copy"><b>{hostel.name}</b><span>{hostel.owner_name} · {hostel.city}</span></div>
              <span className="badge warning">Pending</span>
            </div>
            <div className="admin-activity-controls">
              <Button onClick={() => void verify(hostel.id, "approve")}>Approve</Button>
              <Button kind="danger" onClick={() => void verify(hostel.id, "reject")}>Reject</Button>
            </div>
          </article>)}
          {!pending.length && <p>No hostels pending verification.</p>}
        </div>
        <Link className="admin-inline-link" to="/admin/hostels">Open verification queue <span aria-hidden="true">→</span></Link>
      </Card>
      <div className="stack admin-dashboard-side">
        <Card className="stack admin-quick-actions">
          <div><h2>Quick Actions</h2><p className="muted small">Jump to a platform workspace.</p></div>
          <div className="admin-action-links">
            <Link to="/admin/hostels"><span className="admin-action-icon teal">⌂</span><span>Review hostels</span><span aria-hidden="true">→</span></Link>
            <Link to="/admin/owners"><span className="admin-action-icon blue">♙</span><span>Manage owners</span><span aria-hidden="true">→</span></Link>
            <Link to="/admin/advertisements"><span className="admin-action-icon violet">▧</span><span>Advertisements</span><span aria-hidden="true">→</span></Link>
          </div>
        </Card>
        <Card className="stack admin-subscription-card">
          <div className="spread"><div><h2>Subscription Plans</h2><p className="muted small">Available platform plans</p></div><Link className="admin-inline-link" to="/admin/plans">Manage</Link></div>
          <ErrorBox error={plansError} />
          {plans.slice(0, 3).map((plan) => <div className="admin-plan-row" key={plan.id}>
            <span className="admin-plan-badge" aria-hidden="true">✦</span>
            <div><b>{plan.name}</b><span>{plan.duration_months} months · ₹{Number(plan.price).toLocaleString("en-IN")}</span></div>
            <span className={`badge ${plan.active ? "success" : ""}`}>{plan.active ? "Active" : "Inactive"}</span>
          </div>)}
          {!plansError && !plans.length && <p className="muted small">No subscription plans are available.</p>}
        </Card>
      </div>
    </div>
  </Page>;
}

export function AdminHostelsPage() {
  const [filter, setFilter] = useState("all");
  const [hostels, setHostels] = useState<JsonRecord[]>([]);
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setHostels((await api.get<{ hostels: JsonRecord[] }>(`/admin/hostels?status_filter=${filter}`)).hostels); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load hostels."); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  const action = async (name: string) => {
    if (!selected) return;
    setBusy(true); setError("");
    try { await api.post(`/admin/hostels/${encodeURIComponent(selected.id)}/verify`, { action: name }); setSelected(null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update hostel."); }
    finally { setBusy(false); }
  };
  const activatePlan = async (months: number) => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const result = await api.post<{ amount: number; expires_at: string }>(`/admin/hostels/${encodeURIComponent(selected.id)}/activate-plan`, { months });
      setError(`Plan activated for ₹${result.amount}; expires ${new Date(result.expires_at).toLocaleDateString()}.`);
      setSelected(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not activate plan."); }
    finally { setBusy(false); }
  };
  return <Page title="Hostel Verification" subtitle="Review and manage all listings">
    <ErrorBox error={error} />
    <div className="row admin-filter-row">{["all", "pending", "approved", "suspended", "rejected"].map((item) => <Button key={item} kind={filter === item ? "primary" : "secondary"} onClick={() => setFilter(item)}>{item}</Button>)}</div>
    <div className="grid">{hostels.map((hostel) => <Card className="stack" key={hostel.id}>
      <div className="spread"><div><h2>{hostel.name}</h2><p>{hostel.owner_name} · {hostel.city}, {hostel.state}</p></div><span className="badge">{hostel.status}</span></div>
      <p>Verification: {hostel.verification_status || "Unverified"} · Site visit: {hostel.site_visit_status || "Pending"}</p>{hostel.premium_plan && <p>Plan: {hostel.premium_plan}</p>}
      <div className="row">
        <Link className="button secondary" to={`/hostel/${encodeURIComponent(hostel.id)}`}>View</Link>
        <Button kind="secondary" onClick={() => setSelected(hostel)}>Manage</Button>
      </div>
    </Card>)}</div>{!hostels.length && <Card><p>No hostels match this filter.</p></Card>}
    {selected && <div className="modal-backdrop"><section className="modal"><div className="spread"><h2>{selected.name}</h2><Button kind="ghost" onClick={() => setSelected(null)}>Close</Button></div>
      <div className="stack">{[["approve", "Approve Hostel"], ["suspend", "Suspend Hostel"], ["reactivate", "Reactivate Hostel"], ["reject", "Reject Hostel"]].map(([key, label]) => <Button key={key} kind={key === "reject" ? "danger" : "secondary"} onClick={() => void action(key)} disabled={busy}>{label}</Button>)}
      <hr /><h3>Manual plan activation</h3><p className="muted">Admin activation after offline payment; amount is calculated by the backend.</p><div className="row">{[1, 3, 6, 12].map((months) => <Button key={months} kind="secondary" onClick={() => void activatePlan(months)} disabled={busy}>{months} month{months > 1 ? "s" : ""}</Button>)}</div></div>
    </section></div>}
  </Page>;
}

export function AdminOwnersPage() {
  const [owners, setOwners] = useState<JsonRecord[]>([]);
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  const [password, setPassword] = useState("");
  const [resetMode, setResetMode] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setOwners((await api.get<{ owners: JsonRecord[] }>("/admin/owners")).owners); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load owners."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const action = async (name: string) => {
    if (!selected) return;
    if (name === "reset_password" && (password.length < 8 || password.length > 72)) { setError("Password must be 8–72 characters."); return; }
    setError("");
    try {
      await api.post(`/admin/owners/${encodeURIComponent(selected.id)}/action`, { action: name, ...(name === "reset_password" ? { new_password: password } : {}) });
      setSelected(null); setPassword(""); setResetMode(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update owner."); }
  };
  return <Page title="Owner Management" subtitle={`${owners.length} building owners`}>
    <ErrorBox error={error} />
    <div className="grid">{owners.map((owner) => <Card className="stack" key={owner.id}>
      <h2>{owner.name}</h2><p>{owner.email}</p><p>{owner.mobile || "No mobile"} · {owner.hostels} hostel(s)</p>
      <div className="row"><span className={`badge ${owner.active ? "success" : ""}`}>{owner.active ? "Active" : "Inactive"}</span>{owner.blocked && <span className="badge error">Blocked</span>}</div>
      <Button kind="secondary" onClick={() => { setSelected(owner); setResetMode(false); }}>Manage account</Button>
    </Card>)}</div>
    {selected && <div className="modal-backdrop"><section className="modal"><div className="spread"><h2>{selected.name}</h2><Button kind="ghost" onClick={() => setSelected(null)}>Close</Button></div>
      <div className="stack">
        <Button kind="secondary" onClick={() => void action(selected.active ? "deactivate" : "activate")}>{selected.active ? "Deactivate account" : "Activate account"}</Button>
        <Button kind={selected.blocked ? "secondary" : "danger"} onClick={() => void action(selected.blocked ? "unblock" : "block")}>{selected.blocked ? "Unblock owner" : "Block owner"}</Button>
        {!resetMode ? <Button kind="ghost" onClick={() => setResetMode(true)}>Reset password</Button> : <><Field label="New password" type="password" value={password} onChange={setPassword} min={8} maxLength={72} /><Button onClick={() => void action("reset_password")}>Save new password</Button></>}
      </div>
    </section></div>}
  </Page>;
}

export function AdminPlansPage() {
  const [plans, setPlans] = useState<JsonRecord[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<JsonRecord | null>(null);
  const [name, setName] = useState("");
  const [months, setMonths] = useState("");
  const [price, setPrice] = useState("");
  const [gstRates, setGstRates] = useState<number[]>([]);
  const [features, setFeatures] = useState("");
  const load = useCallback(async () => {
    try { setPlans((await api.get<{ plans: JsonRecord[] }>("/plans")).plans); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load plans."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const openNew = () => { setEditing({}); setName(""); setMonths(""); setPrice(""); setGstRates([]); setFeatures(""); };
  const openEdit = (plan: JsonRecord) => {
    setEditing(plan); setName(plan.name); setMonths(String(plan.duration_months)); setPrice(String(plan.price));
    setGstRates(plan.gst_rates || (plan.gst_rate ? [plan.gst_rate] : [])); setFeatures((plan.features || []).join(", "));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const duration = Number(months); const amount = Number(price);
    if (!name.trim() || !Number.isInteger(duration) || duration < 1 || !/^\d+(\.\d{1,2})?$/.test(price.trim()) || amount <= 0 || !gstRates.length) {
      setError("Enter plan name, positive whole-month duration, positive INR price (up to 2 decimals), and at least one GST rate."); return;
    }
    const body = { name: name.trim(), duration_months: duration, price: amount, gst_rates: gstRates, features: features.split(",").map((item) => item.trim()).filter(Boolean), active: editing?.active ?? true };
    try {
      if (editing?.id) await api.put(`/admin/plans/${encodeURIComponent(editing.id)}`, body);
      else await api.post("/admin/plans", body);
      setEditing(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save subscription plan."); }
  };
  const toggle = async (plan: JsonRecord) => {
    try { await api.post(`/admin/plans/${encodeURIComponent(plan.id)}/toggle`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update plan status."); }
  };
  return <Page title="Subscription Plans" subtitle="Manage owner premium plans" actions={<Button onClick={openNew}>Add plan</Button>}>
    <ErrorBox error={error} /><div className="grid subscription-plan-grid admin-plan-grid">{plans.map((plan) => {
      const gstRates = (plan.gst_rates || [plan.gst_rate]).filter(Boolean);
      return <Card className="stack subscription-plan-card admin-plan-card" key={plan.id}>
        <div className="subscription-plan-heading">
          <span className="subscription-plan-icon" aria-hidden="true">✦</span>
          <div className="subscription-plan-title"><h2>{plan.name}</h2><p>{plan.duration_months} {Number(plan.duration_months) === 1 ? "month" : "months"}</p></div>
          <span className={`badge ${plan.active ? "success" : "error"}`}>{plan.active ? "Active" : "Inactive"}</span>
        </div>
        <div className="subscription-plan-price">₹{Number(plan.price).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <p className="subscription-plan-tax">GST {gstRates.length ? `${gstRates.join("% + ")}%` : "not configured"}</p>
        <div className="subscription-plan-features">
          {(plan.features || []).map((feature: string) => <p key={feature}><span aria-hidden="true">✓</span>{feature}</p>)}
          {!plan.features?.length && <p className="subscription-empty-feature">No features listed</p>}
        </div>
        <div className="subscription-plan-actions">
          <Button kind="secondary" onClick={() => openEdit(plan)}>✎ Edit</Button>
          <Button onClick={() => void toggle(plan)}>{plan.active ? "◉ Deactivate" : "▶ Activate"}</Button>
        </div>
      </Card>;
    })}</div>
    {editing && <div className="modal-backdrop"><section className="modal"><div className="spread"><h2>{editing.id ? "Edit plan" : "New plan"}</h2><Button kind="ghost" onClick={() => setEditing(null)}>Close</Button></div>
      <form className="form" onSubmit={(event) => void save(event)}><Field label="Plan name" value={name} onChange={setName} required /><Field label="Duration (months)" value={months} onChange={setMonths} type="number" min={1} required /><Field label="Base price before GST (INR)" value={price} onChange={setPrice} type="number" min={0.01} required />
        <div className="row">GST rates: {[2, 18].map((rate) => <label className="badge" key={rate}><input type="checkbox" checked={gstRates.includes(rate)} onChange={(event) => setGstRates((current) => event.target.checked ? [...current, rate].sort() : current.filter((value) => value !== rate))} /> {rate}%</label>)}</div>
        <Field label="Features (comma separated)" value={features} onChange={setFeatures} multiline /><Button type="submit">Save plan</Button></form>
    </section></div>}
  </Page>;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const toLocalDateTime = (value: string) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export function AdminAdvertisementsPage() {
  const [campaigns, setCampaigns] = useState<JsonRecord[]>([]);
  const [adsEnabled, setAdsEnabled] = useState(true);
  const [freeCooldown, setFreeCooldown] = useState("30");
  const [premiumCooldown, setPremiumCooldown] = useState("30");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<JsonRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<JsonRecord>(() => emptyAdForm());
  const load = useCallback(async () => {
    const [adResult, settings] = await Promise.all([
      api.get<{ advertisements: JsonRecord[] }>("/admin/advertisements"),
      api.get<JsonRecord>("/admin/advertisements/settings"),
    ]);
    setCampaigns(adResult.advertisements);
    setAdsEnabled(settings.ads_enabled);
    setFreeCooldown(String(settings.free_cooldown_minutes));
    setPremiumCooldown(String(settings.premium_cooldown_minutes));
  }, []);
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load ad campaigns.")); }, [load]);
  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    const free = Number(freeCooldown); const premium = Number(premiumCooldown);
    if (!/^\d+$/.test(freeCooldown) || !/^\d+$/.test(premiumCooldown) || free < 30 || premium < 30 || free > 10080 || premium > 10080) {
      setError("Cooldowns must be whole minutes between 30 and 10,080."); return;
    }
    try {
      const settings = await api.put<JsonRecord>("/admin/advertisements/settings", { ads_enabled: adsEnabled, free_cooldown_minutes: free, premium_cooldown_minutes: premium });
      setFreeCooldown(String(settings.free_cooldown_minutes)); setPremiumCooldown(String(settings.premium_cooldown_minutes)); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save ad settings."); }
  };
  const edit = (campaign?: JsonRecord) => {
    setEditing(campaign || null);
    setForm(campaign ? {
      ...campaign,
      start_at: toLocalDateTime(campaign.start_at), end_at: toLocalDateTime(campaign.end_at),
      daily_start_time: campaign.daily_start_time || "", daily_end_time: campaign.daily_end_time || "",
      days_of_month: (campaign.days_of_month || []).join(", "), days_of_week: campaign.days_of_week || [],
      frequency_limit: campaign.frequency_limit == null ? "" : String(campaign.frequency_limit),
      target_audience: campaign.target_audience || "both",
    } : emptyAdForm());
    setShowForm(true); setError("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const start = new Date(form.start_at); const end = new Date(form.end_at);
    if (!form.title.trim() || !form.target_audience || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      setError("Enter a title, target audience, and valid campaign dates with end after start."); return;
    }
    if (form.media_type !== "link" && !form.media_id) { setError("Upload an image or video, or choose link-only promotion."); return; }
    if (form.destination_url) {
      try { const url = new URL(form.destination_url); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
      catch { setError("Promotional links must be valid HTTP or HTTPS URLs."); return; }
    }
    if (Boolean(form.daily_start_time) !== Boolean(form.daily_end_time)) { setError("Provide both daily display-window times."); return; }
    if (form.frequency_limit && (!/^\d+$/.test(form.frequency_limit) || Number(form.frequency_limit) < 1 || Number(form.frequency_limit) > 100)) { setError("Frequency limit must be a whole number from 1 to 100."); return; }
    let daysOfMonth: number[];
    try {
      const raw = String(form.days_of_month || "").trim();
      daysOfMonth = raw ? raw.split(",").map((item) => {
        if (!/^\d+$/.test(item.trim())) throw new Error("Enter monthly dates as unique numbers from 1 to 31.");
        const day = Number(item.trim());
        if (day < 1 || day > 31) throw new Error("Monthly dates must be between 1 and 31.");
        return day;
      }) : [];
      if (new Set(daysOfMonth).size !== daysOfMonth.length) throw new Error("Monthly dates must be unique.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Invalid monthly dates."); return; }
    const body = {
      ...form, title: form.title.trim(), description: form.description.trim(), alt_text: form.alt_text.trim(),
      start_at: start.toISOString(), end_at: end.toISOString(), destination_url: form.destination_url.trim() || null,
      media_id: form.media_id || null, days_of_month: daysOfMonth,
      frequency_limit: form.frequency_limit ? Number(form.frequency_limit) : null,
      daily_start_time: form.daily_start_time || null, daily_end_time: form.daily_end_time || null,
    };
    setBusy(true); setError("");
    try {
      const result = editing?.id
        ? await api.put<{ advertisement: JsonRecord }>(`/admin/advertisements/${encodeURIComponent(editing.id)}`, body)
        : await api.post<{ advertisement: JsonRecord }>("/admin/advertisements", body);
      if (form.publish_after_save) await api.post(`/admin/advertisements/${encodeURIComponent(result.advertisement.id)}/status`, { action: "publish" });
      setShowForm(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save advertisement."); }
    finally { setBusy(false); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    const isVideo = ["video/mp4", "video/webm"].includes(file.type);
    if ((form.media_type === "image" && (!isImage || file.size > 20 * 1024 * 1024))
      || (form.media_type === "video" && (!isVideo || file.size > 100 * 1024 * 1024))) {
      setError(form.media_type === "image"
        ? "Choose a JPG, JPEG, PNG, or WebP image up to 20 MB."
        : "Choose an MP4 or WebM video up to 100 MB.");
      return;
    }
    setBusy(true); setError("");
    try {
      const result = await api.upload<{ media_id: string; media_type: "image" | "video" }>("/admin/advertisements/media", file);
      setForm((current) => ({ ...current, media_type: result.media_type, media_id: result.media_id }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not upload advertisement media."); }
    finally { setBusy(false); }
  };
  const status = async (campaign: JsonRecord, action: string) => {
    try { await api.post(`/admin/advertisements/${encodeURIComponent(campaign.id)}/status`, { action }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update campaign status."); }
  };
  const remove = async (campaign: JsonRecord) => {
    if (!window.confirm(`Delete "${campaign.title}"?`)) return;
    try { await api.delete(`/admin/advertisements/${encodeURIComponent(campaign.id)}`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete campaign."); }
  };
  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));
  return <Page title="Advertisements" subtitle="Campaign scheduling, delivery and performance">
    <ErrorBox error={error} />
    <Card className="stack"><h2>Ad delivery settings</h2><form className="form" onSubmit={(event) => void saveSettings(event)}>
      <label className="row"><input type="checkbox" checked={adsEnabled} onChange={(event) => setAdsEnabled(event.target.checked)} /><span>Advertisements enabled</span></label>
      <div className="form grid-form"><Field label="Free user cooldown (minutes, 30–10,080)" value={freeCooldown} onChange={setFreeCooldown} type="number" min={30} max={10080} required /><Field label="Premium user cooldown (minutes, 30–10,080)" value={premiumCooldown} onChange={setPremiumCooldown} type="number" min={30} max={10080} required /></div>
      <Button type="submit">Save ad settings</Button></form></Card>
    <div className="spread"><h2>Campaigns ({campaigns.length})</h2><Button onClick={() => edit()}>Create campaign</Button></div>
    <div className="grid">{campaigns.map((campaign) => <Card className="stack" key={campaign.id}>
      <div className="spread"><h3>{campaign.title}</h3><span className="badge">{campaign.status}</span></div>
      <p>{campaign.description}</p><p>{campaign.target_audience} · {campaign.schedule_type} · {campaign.display_duration_seconds}s</p>
      <p>{new Date(campaign.start_at).toLocaleString()} – {new Date(campaign.end_at).toLocaleString()} · {campaign.timezone}</p>
      <p>Impressions {campaign.impressions} · Clicks {campaign.clicks} · CTR {campaign.click_through_rate}%</p>
      <div className="row"><Button kind="secondary" onClick={() => edit(campaign)}>Edit</Button><Button onClick={() => void status(campaign, campaign.status === "active" ? "pause" : "publish")}>{campaign.status === "active" ? "Pause" : "Publish"}</Button><Button kind="danger" onClick={() => void remove(campaign)}>Delete</Button></div>
    </Card>)}</div>
    {showForm && <div className="modal-backdrop"><section className="modal"><div className="spread"><h2>{editing ? "Edit campaign" : "Create campaign"}</h2><Button kind="ghost" onClick={() => setShowForm(false)}>Close</Button></div>
      <form className="form" onSubmit={(event) => void save(event)}>
        <div className="form grid-form"><Field label="Title" value={form.title} onChange={(value) => set("title", value)} required /><Field label="Description" value={form.description} onChange={(value) => set("description", value)} />
          <Field label="Media type" value={form.media_type} onChange={(value) => set("media_type", value)} options={["link", "image", "video"]} />
          <Field label="Audience" value={form.target_audience} onChange={(value) => set("target_audience", value)} options={["users_tenants", "owners", "both"]} />
          <Field label="Destination URL (optional)" value={form.destination_url} onChange={(value) => set("destination_url", value)} type="url" />
          <Field label="Alt text" value={form.alt_text} onChange={(value) => set("alt_text", value)} />
          <Field label="Start time" value={form.start_at} onChange={(value) => set("start_at", value)} type="datetime-local" required />
          <Field label="End time" value={form.end_at} onChange={(value) => set("end_at", value)} type="datetime-local" required />
          <Field label="Timezone" value={form.timezone} onChange={(value) => set("timezone", value)} required />
          <Field label="Display duration (seconds)" value={String(form.display_duration_seconds)} onChange={(value) => set("display_duration_seconds", Number(value))} options={["5", "10", "15", "30"]} />
          <Field label="Frequency per user per day (optional; 1–100)" value={form.frequency_limit} onChange={(value) => set("frequency_limit", value)} type="number" min={1} max={100} />
          <Field label="Schedule" value={form.schedule_type} onChange={(value) => set("schedule_type", value)} options={["daily", "monthly"]} />
          <Field label="Daily start (optional)" value={form.daily_start_time} onChange={(value) => set("daily_start_time", value)} type="time" />
          <Field label="Daily end (optional)" value={form.daily_end_time} onChange={(value) => set("daily_end_time", value)} type="time" />
        </div>
        {form.schedule_type === "daily" ? <div className="tag-row">{WEEKDAYS.map((day, index) => <label className="badge" key={day}><input type="checkbox" checked={form.days_of_week.includes(index)} onChange={(event) => set("days_of_week", event.target.checked ? [...form.days_of_week, index].sort() : form.days_of_week.filter((value: number) => value !== index))} /> {day}</label>)}</div>
          : <Field label="Monthly display dates (comma-separated 1–31)" value={form.days_of_month} onChange={(value) => set("days_of_month", value)} />}
        {form.media_type !== "link" && <label className="field"><span>Upload image (JPG, JPEG, PNG, WebP up to 20 MB) or video (MP4/WebM up to 100 MB)</span><input type="file" accept={form.media_type === "image" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm"} onChange={(event) => void upload(event.target.files?.[0])} /></label>}
        {form.media_id && <p className="muted small">Uploaded media ID: {form.media_id}</p>}
        <label className="row"><input type="checkbox" checked={!!form.publish_after_save} onChange={(event) => set("publish_after_save", event.target.checked)} /><span>Publish after saving</span></label>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save campaign"}</Button>
      </form>
    </section></div>}
  </Page>;
}

function emptyAdForm(): JsonRecord {
  const start = new Date(Date.now() + 60_000); const end = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  return {
    title: "", description: "", media_type: "link", media_id: "", alt_text: "", destination_url: "",
    target_audience: "both", schedule_type: "daily", start_at: toLocalDateTime(start.toISOString()),
    end_at: toLocalDateTime(end.toISOString()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    daily_start_time: "", daily_end_time: "", days_of_week: [], days_of_month: "",
    display_duration_seconds: 15, frequency_limit: "", publish_after_save: false,
  };
}

export function AdminReferralsPage() {
  const [plans, setPlans] = useState<JsonRecord[]>([]);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [rewardCoins, setRewardCoins] = useState("");
  const [coinValue, setCoinValue] = useState("");
  const [redemption, setRedemption] = useState("");
  const [minimum, setMinimum] = useState("");
  const [eligible, setEligible] = useState<string[]>([]);
  const [firstPaidOnly, setFirstPaidOnly] = useState(true);
  const [checkoutCode, setCheckoutCode] = useState(true);
  const [expiry, setExpiry] = useState("");
  const [reverseRefund, setReverseRefund] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [planResult, settingResult] = await Promise.all([
        api.get<{ plans: JsonRecord[] }>("/plans?active_only=true"),
        api.get<{ settings: JsonRecord | null }>("/admin/referrals/settings"),
      ]);
      setPlans(planResult.plans);
      const settings = settingResult.settings;
      if (settings) {
        setEnabled(settings.enabled); setRewardCoins(String(settings.reward_coins_per_referral));
        setCoinValue((settings.coin_value_paise / 100).toFixed(2)); setRedemption(String(settings.max_redemption_percent));
        setMinimum((settings.minimum_qualifying_payment_paise / 100).toFixed(2)); setEligible(settings.eligible_plan_ids || []);
        setFirstPaidOnly(settings.first_paid_subscription_only); setCheckoutCode(settings.allow_checkout_referral_code);
        setExpiry(settings.reward_expiry_days == null ? "" : String(settings.reward_expiry_days));
        setReverseRefund(settings.reverse_unspent_rewards_on_refund);
      }
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load referral settings."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const toPaise = (value: string) => /^\d+(\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : null;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const reward = Number(rewardCoins); const percent = Number(redemption);
    const coinPaise = toPaise(coinValue); const minPaise = toPaise(minimum); const expiryValue = expiry.trim() ? Number(expiry) : null;
    if (!Number.isInteger(reward) || reward < 1 || reward > 1_000_000 || coinPaise == null || coinPaise <= 0 ||
      !Number.isInteger(percent) || percent < 1 || percent > 99 || minPaise == null || minPaise < 0 || !eligible.length ||
      (expiryValue != null && (!Number.isInteger(expiryValue) || expiryValue < 1 || expiryValue > 3650))) {
      setError("Complete each setting with valid values and select at least one plan."); return;
    }
    setBusy(true); setError("");
    try {
      await api.put("/admin/referrals/settings", {
        enabled, reward_coins_per_referral: reward, coin_value_paise: coinPaise, max_redemption_percent: percent,
        eligible_plan_ids: eligible, minimum_qualifying_payment_paise: minPaise,
        first_paid_subscription_only: firstPaidOnly, allow_checkout_referral_code: checkoutCode,
        reward_expiry_days: expiryValue, reverse_unspent_rewards_on_refund: reverseRefund,
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save referral settings."); }
    finally { setBusy(false); }
  };
  return <Page title="Referral settings" subtitle="Configure subscription-only referral coins">
    <ErrorBox error={error} />
    <form className="stack" onSubmit={(event) => void save(event)}>
      <Card className="stack"><h2>Promotion</h2>
        <label className="row"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Referral promotion active</span></label>
        <div className="form grid-form"><Field label="Coins per qualifying referral" value={rewardCoins} onChange={setRewardCoins} type="number" min={1} required /><Field label="INR value per coin" value={coinValue} onChange={setCoinValue} type="number" min={0.01} required />
          <Field label="Maximum redemption per transaction (%)" value={redemption} onChange={setRedemption} type="number" min={1} max={99} required /><Field label="Minimum paid amount to earn reward (INR)" value={minimum} onChange={setMinimum} type="number" min={0} required />
          <Field label="Reward expiry days (blank means no expiry)" value={expiry} onChange={setExpiry} type="number" min={1} max={3650} /></div>
      </Card>
      <Card className="stack"><h2>Eligible plans</h2>{plans.map((plan) => <label className="row" key={plan.id}><input type="checkbox" checked={eligible.includes(plan.id)} onChange={(event) => setEligible((current) => event.target.checked ? [...current, plan.id] : current.filter((id) => id !== plan.id))} /><span>{plan.name} · ₹{Number(plan.price).toFixed(2)} before GST</span></label>)}{!plans.length && <p>No active subscription plans.</p>}</Card>
      <Card className="stack"><h2>Eligibility & reversals</h2>
        <label className="row"><input type="checkbox" checked={firstPaidOnly} onChange={(event) => setFirstPaidOnly(event.target.checked)} /><span>Require referred owner's first paid subscription</span></label>
        <label className="row"><input type="checkbox" checked={checkoutCode} onChange={(event) => setCheckoutCode(event.target.checked)} /><span>Allow referral code at subscription checkout</span></label>
        <label className="row"><input type="checkbox" checked={reverseRefund} onChange={(event) => setReverseRefund(event.target.checked)} /><span>Reverse available, unspent coins after verified refund</span></label>
        <p className="muted">Coins are subscription credits only. They cannot be withdrawn, transferred, or exchanged for cash. Disabling the promotion prevents new rewards and redemptions but does not erase balances.</p>
      </Card>
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save referral settings"}</Button>
    </form>
  </Page>;
}
