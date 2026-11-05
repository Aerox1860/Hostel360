import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AlertMessage, Button, Card, Field, Page } from "../ui";

type JsonRecord = Record<string, any>;

function ErrorBox({ error }: { error: string }) {
  return error ? <AlertMessage tone="error">{error}</AlertMessage> : null;
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<JsonRecord | null>(null);
  const [pending, setPending] = useState<JsonRecord[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [dashboard, hostels] = await Promise.all([
        api.get<JsonRecord>("/admin/dashboard"),
        api.get<{ hostels: JsonRecord[] }>("/admin/hostels?status_filter=pending"),
      ]);
      setStats(dashboard); setPending(hostels.hostels); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load admin overview."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const verify = async (id: string, action: string) => {
    setError("");
    try { await api.post(`/admin/hostels/${encodeURIComponent(id)}/verify`, { action, ...(action === "approve" ? { site_visit_status: "verified" } : {}) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update hostel verification."); }
  };
  return <Page title="Platform Overview" subtitle="Review platform activity and pending hostel listings">
    <ErrorBox error={error} />
    {stats && <div className="grid">{[
      ["Total Hostels", stats.total_hostels], ["Total Owners", stats.total_owners], ["Active Owners", stats.active_owners],
      ["Inactive Owners", stats.inactive_owners], ["Premium Plans", stats.premium_plans], ["Total Revenue", `₹${stats.total_revenue}`],
      ["Expired Plans", stats.expired_plans], ["New Registrations", stats.new_registrations],
    ].map(([label, value]) => <Card key={String(label)}><span className="muted">{label}</span><div className="stat">{value ?? "—"}</div></Card>)}</div>}
    <Card className="stack"><div className="spread"><h2>Pending Verification</h2><span className="badge warning">{pending.length}</span></div>
      {pending.map((hostel) => <article className="card stack" key={hostel.id}><b>{hostel.name}</b><p>{hostel.owner_name} · {hostel.mobile}</p><p>{hostel.address}, {hostel.city}</p>
        <div className="row"><Button onClick={() => void verify(hostel.id, "approve")}>Approve</Button><Button kind="danger" onClick={() => void verify(hostel.id, "reject")}>Reject</Button></div></article>)}
      {!pending.length && <p>No hostels pending verification.</p>}
    </Card>
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
    <div className="row">{["all", "pending", "approved", "suspended", "rejected"].map((item) => <Button key={item} kind={filter === item ? "primary" : "secondary"} onClick={() => setFilter(item)}>{item}</Button>)}</div>
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
    <ErrorBox error={error} /><div className="grid">{plans.map((plan) => <Card className="stack" key={plan.id}>
      <div className="spread"><div><h2>{plan.name}</h2><p>{plan.duration_months} months</p></div><div className="text-right"><b>₹{Number(plan.price).toFixed(2)}</b><p>GST {(plan.gst_rates || [plan.gst_rate]).filter(Boolean).join("% + ")}%</p><span className="badge">{plan.active ? "Active" : "Inactive"}</span></div></div>
      {(plan.features || []).map((feature: string) => <p key={feature}>✓ {feature}</p>)}
      <div className="row"><Button kind="secondary" onClick={() => openEdit(plan)}>Edit</Button><Button kind="ghost" onClick={() => void toggle(plan)}>{plan.active ? "Deactivate" : "Activate"}</Button></div>
    </Card>)}</div>
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
