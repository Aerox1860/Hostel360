import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../state";
import { useTenantPolicy } from "../tenant-policy-state";
import { AdvertisementSlot } from "../ads";
import { AlertMessage, Button, Card, Field, Page } from "../ui";

type JsonRecord = Record<string, any>;

function ErrorBox({ error }: { error: string }) {
  return error ? <AlertMessage tone="error">{error}</AlertMessage> : null;
}

function useTenantResource<T>(path: string, initial: T) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setError("");
    try { setData(await api.get<T>(path)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load data."); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, setData, error, setError, loading, load };
}

export function TenantHomePage() {
  const { user } = useAuth();
  const resource = useTenantResource<JsonRecord>("/tenant/home", {});
  const data = resource.data;
  const tenant = data.tenant || {};
  const hostel = data.hostel || {};
  if (resource.loading) return <Page title="My Room"><p className="muted">Loading your room…</p></Page>;
  return <Page title={`Hi, ${(tenant.name || user?.name || "Tenant").split(" ")[0]}`} subtitle={hostel.name || "My Room"}>
    <ErrorBox error={resource.error} />
    {!data.has_allocation ? <Card className="stack"><h2>No active room allocation</h2><p>Your hostel owner hasn't allocated a room to you yet. Please contact them.</p><Link className="button secondary" to="/tenant/history-sharing">Global history sharing</Link></Card> : <>
      {data.tenant?.policy_review_required && <AlertMessage tone="info">Please review the current hostel rules. <Link to="/tenant/policy-review">Review rules</Link></AlertMessage>}
      <Card className="stack">
        <div className="spread"><div><span className="muted">Monthly Rent</span><div className="stat">₹{tenant.monthly_rent}</div></div>
          <span className={`badge ${tenant.payment_status === "due" ? "warning" : "success"}`}>{data.pending_rent_payment ? "PENDING APPROVAL" : tenant.payment_status === "due" ? "DUE" : "PAID"}</span></div>
        {data.pending_rent_payment && <p>₹{data.pending_rent_payment.amount} submitted for owner approval. Rent is not marked paid yet.</p>}
        {tenant.last_paid && <p className="muted">Last paid: {new Date(tenant.last_paid).toLocaleDateString()}</p>}
        {tenant.payment_status === "due" && <Link className="button primary" to="/tenant/payments">Pay Rent Now</Link>}
      </Card>
      <Card className="stack"><h2>Room Details</h2><div className="grid">
        {[
          ["Tenant ID", tenant.tenant_code], ["Room", tenant.room_number], ["Bed", tenant.bed_number],
          ["Joined", tenant.joining_date ? new Date(tenant.joining_date).toLocaleDateString() : ""],
          ["Deposit", `₹${tenant.security_deposit || 0}`], ["Advance", `₹${tenant.advance_amount || 0}`],
        ].map(([label, value]) => <div key={String(label)}><span className="muted small">{label}</span><div><b>{value || "—"}</b></div></div>)}
      </div></Card>
      {hostel && <Card className="stack"><h2>{hostel.name}</h2><p>{hostel.address}, {hostel.city}</p>{hostel.mobile && <a className="button secondary" href={`tel:${encodeURIComponent(hostel.mobile)}`}>Call Owner</a>}</Card>}
      <AdvertisementSlot />
      <Link to="/tenant/history-sharing">Global history sharing</Link>
    </>}
  </Page>;
}

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function validDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

export function TenantPaymentsPage() {
  const resource = useTenantResource<{ payments: JsonRecord[]; hostel: JsonRecord; tenant: JsonRecord }>("/tenant/payments", { payments: [], hostel: {}, tenant: {} });
  const { payments, hostel, tenant } = resource.data;
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayLocalDate);
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("phonepe");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (tenant && !amount) setAmount(String(tenant.rent_balance ?? (tenant.payment_status === "due" ? tenant.monthly_rent : "")));
  }, [tenant, amount]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || !validDate(paymentDate) || !reference.trim() || !(hostel?.upi_id || hostel?.upi_qr_code)) {
      setError("Enter a valid amount, payment date and UPI reference. The hostel must have UPI details configured.");
      return;
    }
    setBusy(true); setError("");
    try {
      let screenshot_data: string | undefined;
      if (screenshot) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(screenshot.type) || screenshot.size > 3 * 1024 * 1024) throw new Error("Choose a JPG, PNG, or WebP screenshot up to 3 MB.");
        screenshot_data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not read payment screenshot."));
          reader.readAsDataURL(screenshot);
        });
      }
      await api.post("/tenant/rent-payment", {
        amount: Number(amount), payment_date: paymentDate.trim(), upi_reference: reference.trim(), method,
        ...(screenshot_data ? { screenshot_data, screenshot_name: screenshot?.name || "upi-payment.png", screenshot_content_type: screenshot?.type } : {}),
      });
      setReference(""); setScreenshot(null); await resource.load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit payment."); }
    finally { setBusy(false); }
  };
  const copyUpi = async () => {
    if (!hostel?.upi_id) return;
    try { await navigator.clipboard.writeText(hostel.upi_id); }
    catch { setError("Clipboard access is unavailable in this browser."); }
  };
  const openUpi = () => {
    if (!hostel?.upi_id) return setError("Ask the hostel owner to configure a UPI ID.");
    const scheme = { phonepe: "phonepe://pay", google_pay: "tez://upi/pay", paytm: "paytmmp://pay", other_upi: "upi://pay" }[method] || "upi://pay";
    const params = new URLSearchParams({ pa: hostel.upi_id, pn: hostel.name || hostel.pg_name || "Hostel", am: amount, cu: "INR", tn: "Hostel rent" });
    window.location.href = `${scheme}?${params}`;
  };
  const paidTotal = payments.filter((item) => item.status === "paid").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pending = payments.find((item) => ["pending_owner_approval", "approval_processing"].includes(item.status));
  return <Page title="Payments" subtitle="History & receipts">
    <ErrorBox error={resource.error || error} />
    {resource.loading ? <p className="muted">Loading payments…</p> : <>
      {paidTotal > 0 && <Card><span className="muted">Total paid</span><div className="stat">₹{paidTotal.toLocaleString("en-IN")}</div></Card>}
      {pending && <AlertMessage tone="info">₹{pending.amount} submitted for owner approval. Rent is not marked paid until approved.</AlertMessage>}
      <Card className="stack"><h2>Pay Rent</h2>
        {hostel?.upi_qr_code && <img src={hostel.upi_qr_code} alt="Hostel UPI QR code" className="qr-image" />}
        {hostel?.upi_id && <div className="row"><span>UPI ID: <b>{hostel.upi_id}</b></span><Button kind="secondary" onClick={() => void copyUpi()}>Copy UPI ID</Button></div>}
        <div className="row">{["phonepe", "google_pay", "paytm", "other_upi"].map((item) => <Button key={item} kind={method === item ? "primary" : "secondary"} onClick={() => setMethod(item)}>{item.replace("_", " ")}</Button>)}</div>
        <Button kind="secondary" onClick={openUpi}>Open selected UPI app</Button>
        <form className="form" onSubmit={(event) => void submit(event)}>
          <Field label="Paid amount (₹)" value={amount} onChange={setAmount} type="number" min={0.01} required />
          <Field label="Payment date" value={paymentDate} onChange={setPaymentDate} type="date" required />
          <Field label="UPI reference / transaction ID" value={reference} onChange={setReference} required />
          <label className="field"><span>Payment screenshot (optional; JPG, PNG or WebP; up to 3 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setScreenshot(event.target.files?.[0] || null)} /></label>
          {screenshot && <span className="muted">{screenshot.name}</span>}
          <Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit payment for approval"}</Button>
        </form>
      </Card>
      <Card className="stack"><h2>Payment history</h2>{!payments.length ? <p>No payment records yet.</p> : <div className="table-scroll"><table><thead><tr><th>Date</th><th>Amount</th><th>Type</th><th>Method</th><th>Status</th><th>Receipt</th></tr></thead><tbody>
        {payments.map((payment) => <tr key={payment.id}><td>{payment.date ? new Date(payment.date).toLocaleDateString() : "—"}</td><td>₹{payment.amount}</td><td>{payment.type}</td><td>{payment.method}</td><td><span className="badge">{payment.status}</span></td><td>{payment.status === "paid" && <Button kind="secondary" onClick={() => window.print()}>Print</Button>}</td></tr>)}
      </tbody></table></div>}</Card>
    </>}
  </Page>;
}

export function TenantNoticesPage() {
  const resource = useTenantResource<{ notices: JsonRecord[] }>("/tenant/notices", { notices: [] });
  return <Page title="Notices" subtitle="Updates from your hostel">
    <ErrorBox error={resource.error} />{resource.loading ? <p className="muted">Loading notices…</p> : resource.data.notices.length
      ? resource.data.notices.map((notice) => <Card className="stack" key={notice.id}><h2>{notice.title}</h2><p>{notice.body}</p><span className="muted small">{notice.created_at ? new Date(notice.created_at).toLocaleString() : ""}</span></Card>)
      : <Card><p>No notices yet.</p></Card>}
  </Page>;
}

export function TenantSupportPage() {
  const resource = useTenantResource<{ complaints: JsonRecord[]; requests: JsonRecord[] }>("/tenant/complaints", { complaints: [], requests: [] });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!title.trim() || !body.trim()) throw new Error("Enter a title and description.");
      await api.post("/tenant/complaints", { title: title.trim(), body: body.trim() });
      setTitle(""); setBody(""); await resource.load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit complaint."); }
    finally { setBusy(false); }
  };
  const request = async (type: "room_change" | "checkout") => {
    setError("");
    try { await api.post("/tenant/requests", { type, note: "" }); await resource.load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit request."); }
  };
  return <Page title="Complaints & Requests">
    <ErrorBox error={resource.error || error} />
    <Card className="stack"><h2>Submit complaint</h2><form className="form" onSubmit={(event) => void send(event)}>
      <Field label="Title" value={title} onChange={setTitle} required /><Field label="Description" value={body} onChange={setBody} multiline required />
      <Button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit complaint"}</Button>
    </form></Card>
    <Card className="stack"><h2>Requests</h2><div className="row"><Button kind="secondary" onClick={() => void request("room_change")}>Request Room Change</Button><Button kind="secondary" onClick={() => void request("checkout")}>Request Checkout</Button></div>
      {resource.data.requests.map((item) => <p key={item.id}>{String(item.type).replaceAll("_", " ")} · {item.status}</p>)}
    </Card>
    <Card className="stack"><h2>My complaints</h2>{resource.data.complaints.length ? resource.data.complaints.map((item) => <p key={item.id}><b>{item.title}</b> · {item.status}<br />{item.body}</p>) : <p>No complaints submitted.</p>}</Card>
    <Card className="stack"><h2>My requests</h2>{resource.data.requests.length ? resource.data.requests.map((item) => <p key={item.id}>{item.type} · {item.status}</p>) : <p>No requests submitted.</p>}</Card>
  </Page>;
}

export function TenantHistorySharingPage() {
  const [consent, setConsent] = useState<JsonRecord | null>(null);
  const [reports, setReports] = useState<JsonRecord[]>([]);
  const [notifications, setNotifications] = useState<JsonRecord[]>([]);
  const [code, setCode] = useState("");
  const [expiry, setExpiry] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const current = await api.get<JsonRecord>("/tenant/global-history/consent");
      setConsent(current);
      const [history, alerts] = await Promise.all([
        api.get<{ reports: JsonRecord[] }>("/tenant/global-history/reports"),
        api.get<{ notifications: JsonRecord[] }>("/tenant/global-history/notifications"),
      ]);
      setReports(history.reports || []); setNotifications(alerts.notifications || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load sharing settings."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const saveConsent = async (consented: boolean, autoLookup = false) => {
    try {
      const result = await api.put<JsonRecord>("/tenant/global-history/consent", { consented, auto_lookup_consented: consented && autoLookup });
      setConsent((current) => ({ ...current, ...result, consented, auto_lookup_consented: consented && autoLookup }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update consent."); }
  };
  const generate = async () => {
    try { const result = await api.post<{ code: string; expires_at: string }>("/tenant/global-history/share-code", {}); setCode(result.code); setExpiry(result.expires_at); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate share code."); }
  };
  const submitResponse = async (id: string) => {
    const response = responses[id]?.trim();
    if (!response) return;
    try {
      await api.post(`/tenant/global-history/reports/${encodeURIComponent(id)}/response`, { response });
      setResponses((current) => ({ ...current, [id]: "" })); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit response."); }
  };
  const markRead = async (id: string) => {
    try { await api.put(`/tenant-history/notifications/${encodeURIComponent(id)}/read`, {}); setNotifications((items) => items.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not mark notification read."); }
  };
  return <Page title="Global history sharing" subtitle="Your choice, your control">
    <ErrorBox error={error} />
    {loading ? <p className="muted">Loading sharing preferences…</p> : <>
      <Card className="stack"><p>One-time codes let you share history with one owner. Automatic checks are only available for identity-verified accounts when you explicitly enable them. Reports are allegations unless their status says otherwise.</p>
        <label className="row"><input type="checkbox" checked={consent?.consented === true} onChange={(event) => void saveConsent(event.target.checked)} /><span>Enable one-time code sharing</span></label>
        <label className="row"><input type="checkbox" checked={consent?.auto_lookup_consented === true} disabled={!consent?.consented || !consent?.identity_verified} onChange={(event) => void saveConsent(true, event.target.checked)} /><span>Allow consent-based automatic history checks (identity verification required)</span></label>
        <Button disabled={!consent?.consented} onClick={() => void generate()}>Generate one-time share code</Button>
        {code && <AlertMessage tone="success">Code: <b>{code}</b> · Expires {expiry ? new Date(expiry).toLocaleString() : "soon"}</AlertMessage>}
      </Card>
      <Card className="stack"><h2>History reports</h2>{reports.length ? reports.map((report) => <article className="card" key={report.id}>
        <b>{report.previous_hostel || "Previous hostel"} · {report.category || "Report"}</b><p>Status: {report.status || "Pending"} · Outstanding ₹{report.outstanding_balance ?? report.amount ?? 0}</p>
        <p>{report.details}</p>{report.tenant_response?.text && <p>Your response: {report.tenant_response.text}</p>}
        {["pending", "disputed"].includes(report.status) && <div className="stack"><Field label="Your response" value={responses[report.id] || ""} onChange={(value) => setResponses((current) => ({ ...current, [report.id]: value }))} multiline /><Button onClick={() => void submitResponse(report.id)}>Submit response</Button></div>}
      </article>) : <p>No history reports.</p>}</Card>
      <Card className="stack"><h2>Notifications</h2>{notifications.length ? notifications.map((item) => <div className="spread" key={item.id}><span>{item.message || item.event}</span>{!item.read_at && <Button kind="secondary" onClick={() => void markRead(item.id)}>Mark read</Button>}</div>) : <p>No notifications.</p>}</Card>
    </>}
  </Page>;
}

export function TenantPolicyPage() {
  const navigate = useNavigate();
  const { setStatus } = useTenantPolicy();
  const resource = useTenantResource<{ required: boolean; policy: JsonRecord | null }>("/tenant/rules/pending", { required: false, policy: null });
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const acknowledge = async () => {
    if (!resource.data.policy || !checked) return;
    try {
      const result = await api.post<{ ok: boolean }>("/tenant/rules/acknowledge", { policy_id: resource.data.policy.id });
      if (!result.ok) throw new Error("The server did not confirm the acknowledgement.");
      setStatus("allowed");
      navigate("/tenant", { replace: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit acknowledgement."); }
  };
  return <Page title="Rules & Regulations" subtitle={resource.data.policy ? `Required policy version ${resource.data.policy.version}` : undefined}>
    <ErrorBox error={resource.error || error} />
    {resource.loading ? <p className="muted">Loading current hostel rules…</p> : !resource.data.required || !resource.data.policy
      ? <Card><p>No new rules require review.</p></Card>
      : <Card className="stack"><article className="policy-text">{resource.data.policy.text}</article>
        <label className="row"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>I have read and understood the current hostel rules.</span></label>
        <Button disabled={!checked} onClick={() => void acknowledge()}>Acknowledge rules</Button>
      </Card>}
  </Page>;
}
