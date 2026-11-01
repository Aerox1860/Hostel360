import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useOwnerHostel } from "../owner-state";
import { AlertMessage, Button, Card, Field, Page } from "../ui";
import { PropertyForm } from "./owner";

type JsonRecord = Record<string, any>;

function ErrorBox({ error }: { error: string }) {
  return error ? <AlertMessage tone="error">{error}</AlertMessage> : null;
}

export function OwnerRegistrationPage() {
  const { activeId, activeHostel } = useOwnerHostel();
  const [registration, setRegistration] = useState<JsonRecord | null>(null);
  const [applications, setApplications] = useState<JsonRecord[]>([]);
  const [rooms, setRooms] = useState<JsonRecord[]>([]);
  const [allocations, setAllocations] = useState<Record<string, { room_id: string; bed_number: string }>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    if (!activeId) return;
    const query = `hostel_id=${encodeURIComponent(activeId)}`;
    try {
      const [qr, appResult, roomResult] = await Promise.all([
        api.get<{ registration: JsonRecord | null }>(`/owner/tenant-registration-qr?${query}`),
        api.get<{ applications: JsonRecord[] }>(`/owner/tenant-applications?${query}`),
        api.get<{ rooms: JsonRecord[] }>(`/owner/rooms?${query}`),
      ]);
      setRegistration(qr.registration); setApplications(appResult.applications); setRooms(roomResult.rooms); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load tenant registration."); }
  }, [activeId]);
  useEffect(() => { void load(); }, [load]);
  const qrAction = async (action: "generate" | "revoke") => {
    if (!activeId) return;
    if (action === "revoke" && !window.confirm("Revoke the current tenant registration QR? The link will stop working.")) return;
    setBusy(action); setError("");
    try {
      if (action === "generate") {
        const result = await api.post<{ registration: JsonRecord }>(`/owner/tenant-registration-qr?hostel_id=${encodeURIComponent(activeId)}`);
        setRegistration(result.registration);
      } else {
        await api.delete(`/owner/tenant-registration-qr?hostel_id=${encodeURIComponent(activeId)}`);
        setRegistration(null);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not ${action} QR.`); }
    finally { setBusy(""); }
  };
  const updateApplication = async (application: JsonRecord, status: "approved" | "rejected") => {
    setBusy(application.id); setError("");
    try {
      await api.put(`/owner/tenant-applications/${encodeURIComponent(application.id)}`, { status });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update application."); }
    finally { setBusy(""); }
  };
  const allocate = async (application: JsonRecord) => {
    const selection = allocations[application.id] || { room_id: "", bed_number: "" };
    if (!selection.room_id || !selection.bed_number) { setError("Select an available room and bed before allocating."); return; }
    setBusy(application.id); setError("");
    try {
      await api.post(`/owner/tenant-applications/${encodeURIComponent(application.id)}/allocation`, selection);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Allocation failed. The application remains available to retry."); }
    finally { setBusy(""); }
  };
  const copyLink = async () => {
    if (!registration?.registration_url) return;
    try { await navigator.clipboard.writeText(registration.registration_url); }
    catch { setError("Clipboard access is unavailable in this browser."); }
  };
  const printQr = () => {
    if (!registration?.qr_data_uri) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) { setError("The browser blocked the print window. Allow pop-ups and retry."); return; }
    const title = printWindow.document.createElement("h1");
    title.textContent = activeHostel?.name || "Tenant registration";
    const label = printWindow.document.createElement("p");
    label.textContent = "Scan to apply for a room";
    const image = printWindow.document.createElement("img");
    image.alt = "Tenant registration QR";
    image.src = registration.qr_data_uri;
    image.style.width = "280px";
    image.style.height = "280px";
    const link = printWindow.document.createElement("p");
    link.textContent = registration.registration_url;
    printWindow.document.body.replaceChildren(title, label, image, link);
    printWindow.document.title = "Hostel360 tenant registration QR";
    image.onload = () => printWindow.print();
  };
  const shareLink = async () => {
    if (!registration?.registration_url) return;
    if (!navigator.share) { setError("Link sharing is not available in this browser; use Copy link instead."); return; }
    try { await navigator.share({ title: activeHostel?.name || "Tenant registration", url: registration.registration_url }); }
    catch (reason) { if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message); }
  };
  const freeBeds = (room: JsonRecord) => (room.beds || []).filter((bed: JsonRecord) => bed.status !== "occupied" && !bed.tenant_id);
  return <Page title="Tenant registration" subtitle={`${activeHostel?.name || "Selected hostel"} · QR links and applications`}>
    <ErrorBox error={error} />
    <Card className="stack"><h2>Registration QR</h2><p>Create a secure registration link for prospective tenants. Generating a new QR revokes the previous one.</p>
      {registration ? <>
        <img className="registration-qr" src={registration.qr_data_uri} alt={`Tenant registration QR for ${activeHostel?.name || "hostel"}`} />
        <p className="small">{registration.registration_url}</p><p className="muted small">Expires {registration.expires_at ? new Date(registration.expires_at).toLocaleString() : "according to current policy"}</p>
        <div className="row"><Button kind="secondary" onClick={() => void copyLink()}>Copy link</Button><Button kind="secondary" onClick={() => void shareLink()}>Share link</Button><a className="button secondary" href={registration.qr_data_uri} download="hostel360-tenant-registration.png">Download QR</a><Button kind="secondary" onClick={printQr}>Print</Button><Button kind="danger" onClick={() => void qrAction("revoke")} disabled={!!busy}>Revoke QR</Button></div>
      </> : <Button onClick={() => void qrAction("generate")} disabled={!!busy}>{busy === "generate" ? "Generating…" : "Generate QR code"}</Button>}
    </Card>
    <Card className="stack"><h2>Tenant applications ({applications.length})</h2>{applications.map((application) => <article className="card stack" key={application.id}>
      <div className="spread"><b>{application.name}</b><span className="badge">{application.status}</span></div>
      <p>{application.mobile} · {application.email || "No email"} · {application.preferences || "No preferences"}</p><p className="muted small">{application.created_at ? new Date(application.created_at).toLocaleString() : ""}</p>
      {application.status === "pending" && <div className="row"><Button onClick={() => void updateApplication(application, "approved")} disabled={!!busy}>Approve</Button><Button kind="danger" onClick={() => void updateApplication(application, "rejected")} disabled={!!busy}>Reject</Button></div>}
      {["approved", "allocating"].includes(application.status) && <div className="stack">
        <div className="form grid-form">
          <Field label="Room" value={allocations[application.id]?.room_id || application.allocation_room_id || ""} onChange={(value) => setAllocations((current) => ({ ...current, [application.id]: { room_id: value, bed_number: "" } }))} options={rooms.filter((room) => freeBeds(room).length).map((room) => room.id)} optionLabels={Object.fromEntries(rooms.map((room) => [room.id, `Room ${room.room_number}`]))} />
          <Field label="Bed" value={allocations[application.id]?.bed_number || application.allocation_bed_number || ""} onChange={(value) => setAllocations((current) => ({ ...current, [application.id]: { room_id: current[application.id]?.room_id || application.allocation_room_id || "", bed_number: value } }))} options={freeBeds(rooms.find((room) => room.id === (allocations[application.id]?.room_id || application.allocation_room_id)) || {}).map((bed: JsonRecord) => String(bed.bed_number))} />
        </div><Button onClick={() => void allocate(application)} disabled={!!busy}>Allocate and create tenant</Button>
      </div>}
    </article>)}{!applications.length && <p>No applications yet.</p>}</Card>
  </Page>;
}

export function OwnerAlertsPage() {
  const { activeId } = useOwnerHostel();
  const [notifications, setNotifications] = useState<JsonRecord[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!activeId) return;
    try {
      const result = await api.get<{ notifications: JsonRecord[] }>(`/owner/tenant-history/notifications?hostel_id=${encodeURIComponent(activeId)}`);
      setNotifications(result.notifications || []); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load notifications."); }
  }, [activeId]);
  useEffect(() => { void load(); }, [load]);
  const markRead = async (id: string) => {
    try {
      await api.put(`/tenant-history/notifications/${encodeURIComponent(id)}/read`, {});
      setNotifications((current) => current.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not mark notification read."); }
  };
  return <Page title="Alerts" subtitle={`${notifications.filter((item) => !item.read_at).length} unread`}>
    <ErrorBox error={error} />
    <Card className="stack">{notifications.map((item) => <article className="spread" key={item.id}>
      <div><b>{item.message || item.event || "Hostel notification"}</b><p className="muted small">{item.created_at ? new Date(item.created_at).toLocaleString() : ""} {item.amount != null ? `· ₹${item.amount}` : ""}</p>{item.status && <span className="badge">{item.status}</span>}</div>
      {!item.read_at && <Button kind="secondary" onClick={() => void markRead(item.id)}>Mark read</Button>}
    </article>)}{!notifications.length && <p>No notifications.</p>}</Card>
  </Page>;
}

export function OwnerRulesPage() {
  const { activeId } = useOwnerHostel();
  const [latest, setLatest] = useState<JsonRecord | null>(null);
  const [history, setHistory] = useState<JsonRecord[]>([]);
  const [acknowledgements, setAcknowledgements] = useState<JsonRecord[]>([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ id: string; name: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    if (!activeId) return;
    const query = `hostel_id=${encodeURIComponent(activeId)}`;
    try {
      const [rules, ack] = await Promise.all([
        api.get<JsonRecord>(`/owner/rules?${query}`),
        api.get<JsonRecord>(`/owner/rules/acknowledgements?${query}`),
      ]);
      setLatest(rules.latest); setHistory(rules.history || []);
      setText(rules.draft?.text ?? rules.latest?.text ?? "");
      setImages((rules.draft?.source_image_ids || []).map((id: string, index: number) => ({ id, name: `Saved source image ${index + 1}` })));
      setAcknowledgements(ack.acknowledgements || []); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load hostel rules."); }
  }, [activeId]);
  useEffect(() => { void load(); }, [load]);
  const uploadImages = async () => {
    if (!activeId || !files.length) return;
    setBusy("upload"); setError("");
    try {
      const added: { id: string; name: string }[] = [];
      for (const file of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Rules images must be JPG, PNG or WebP and 10 MB or smaller.");
        const result = await api.upload<{ upload_id: string }>(`/owner/rules/images?hostel_id=${encodeURIComponent(activeId)}`, file);
        added.push({ id: result.upload_id, name: file.name });
      }
      setImages((current) => [...current, ...added]); setFiles([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not upload rules images."); }
    finally { setBusy(""); }
  };
  const removeImage = async (id: string) => {
    try { await api.delete(`/owner/rules/images/${encodeURIComponent(id)}`); setImages((current) => current.filter((item) => item.id !== id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove source image."); }
  };
  const runOcr = async () => {
    setBusy("ocr"); setError("");
    try {
      const result = await api.post<{ text: string; uncertain_sections?: string[] }>("/owner/rules/ocr", { hostel_id: activeId, upload_ids: images.map((item) => item.id) });
      setText(result.text || "");
      if (result.uncertain_sections?.length) setError(`Please review uncertain extracted sections: ${result.uncertain_sections.join(", ")}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not extract text from images."); }
    finally { setBusy(""); }
  };
  const saveDraft = async (event?: FormEvent) => {
    event?.preventDefault(); setBusy("draft"); setError("");
    try { await api.put("/owner/rules/draft", { hostel_id: activeId, text, source_image_ids: images.map((item) => item.id) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save rules draft."); }
    finally { setBusy(""); }
  };
  const publish = async () => {
    if (!text.trim() || !window.confirm("Publish these rules? Tenants will be required to review the current policy.")) return;
    setBusy("publish"); setError("");
    try {
      await api.post("/owner/rules/publish", { hostel_id: activeId, text, source_image_ids: images.map((item) => item.id) });
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not publish rules."); }
    finally { setBusy(""); }
  };
  return <Page title="Rules & Regulations" subtitle={latest ? `Current version ${latest.version}` : "Draft and publish hostel policies"}>
    <ErrorBox error={error} />
    <Card className="stack"><h2>Source images</h2><label className="field"><span>Choose rules images</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} /></label>
      {files.length > 0 && <div className="spread"><span>{files.length} selected</span><Button onClick={() => void uploadImages()} disabled={!!busy}>Upload selected images</Button></div>}
      {images.map((image) => <div className="spread" key={image.id}><span>{image.name}</span><Button kind="danger" onClick={() => void removeImage(image.id)}>Remove</Button></div>)}
      <Button kind="secondary" onClick={() => void runOcr()} disabled={!images.length || !!busy}>{busy === "ocr" ? "Extracting…" : "Extract text from images"}</Button>
    </Card>
    <Card className="stack"><h2>Policy text</h2><form className="form" onSubmit={(event) => void saveDraft(event)}><Field label="Rules and regulations" value={text} onChange={setText} multiline required /><div className="row"><Button type="submit" disabled={!!busy}>{busy === "draft" ? "Saving…" : "Save draft"}</Button><Button kind="secondary" onClick={() => void publish()} disabled={!text.trim() || !!busy}>{busy === "publish" ? "Publishing…" : "Publish rules"}</Button></div></form></Card>
    <Card className="stack"><h2>Published versions</h2>{history.map((item) => <details key={item.id}><summary>Version {item.version} · {item.published_at ? new Date(item.published_at).toLocaleString() : ""}</summary><pre className="policy-text">{item.text}</pre></details>)}{!history.length && latest && <p>Version {latest.version}</p>}</Card>
    <Card className="stack"><h2>Tenant acknowledgements</h2>{acknowledgements.map((item) => <p key={item.id || item.tenant_id}>{item.tenant_name || item.name} · {item.acknowledged_at ? new Date(item.acknowledged_at).toLocaleString() : "Pending"}</p>)}{!acknowledgements.length && <p>No acknowledgements available.</p>}</Card>
  </Page>;
}

export function OwnerReferralsPage() {
  const [data, setData] = useState<JsonRecord | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await api.get<JsonRecord>("/owner/referrals")); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load referral program."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); }
    catch { setError("Clipboard access is unavailable in this browser."); }
  };
  return <Page title="Refer & Earn" subtitle="Subscription coins, not cash">
    <ErrorBox error={error} />
    {!data ? <Button kind="secondary" onClick={() => void load()}>Retry</Button> : <>
      <Card className="stack"><span className="muted">Your referral code</span><div className="stat">{data.referral_code}</div><p>{data.referral_link}</p>
        <div className="row"><Button kind="secondary" onClick={() => void copy(data.referral_code)}>Copy code</Button><Button kind="secondary" onClick={() => void copy(data.referral_link)}>Copy link</Button><Button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Join Hostel360 with my referral code ${data.referral_code}: ${data.referral_link}`)}`, "_blank", "noopener,noreferrer")}>WhatsApp</Button></div>
      </Card>
      {!data.enabled && <AlertMessage tone="info">The referral promotion is currently paused. Rewards and redemption are unavailable while disabled.</AlertMessage>}
      <div className="grid"><Card><span className="muted">Referrals</span><div className="stat">{data.total_referrals}</div></Card><Card><span className="muted">Successful</span><div className="stat">{data.successful_referrals}</div></Card></div>
      <Card className="stack"><h2>Subscription coin wallet</h2>{Object.entries(data.wallet || {}).map(([key, value]) => <div className="spread" key={key}><span>{key.replaceAll("_", " ")}</span><b>{String(value)}</b></div>)}</Card>
      <Card className="stack"><h2>Referrals</h2>{(data.referrals || []).map((item: JsonRecord) => <p key={item.owner_id}>{item.name || item.email || item.owner_id} · {item.status}</p>)}{!data.referrals?.length && <p>No referrals yet.</p>}</Card>
      <Card className="stack"><h2>Coin ledger</h2>{(data.ledger || []).map((item: JsonRecord) => <p key={item.id}>{item.event} · {item.coins} coins · {new Date(item.created_at).toLocaleDateString()}</p>)}</Card>
      {data.notice && <p className="muted">{data.notice}</p>}
    </>}
  </Page>;
}

export function OwnerMorePage() {
  const { activeId, refresh } = useOwnerHostel();
  const [reports, setReports] = useState<JsonRecord | null>(null);
  const [hostel, setHostel] = useState<JsonRecord | null>(null);
  const [subscription, setSubscription] = useState<JsonRecord | null>(null);
  const [notices, setNotices] = useState<JsonRecord[]>([]);
  const [complaints, setComplaints] = useState<JsonRecord[]>([]);
  const [requests, setRequests] = useState<JsonRecord[]>([]);
  const [enquiries, setEnquiries] = useState<JsonRecord[]>([]);
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeBody, setNoticeBody] = useState("");
  const [error, setError] = useState("");
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState("");
  const [checkout, setCheckout] = useState<JsonRecord | null>(null);
  const [coins, setCoins] = useState("0");
  const [quote, setQuote] = useState<JsonRecord | null>(null);
  const [editHostel, setEditHostel] = useState<JsonRecord | null>(null);
  const load = useCallback(async () => {
    if (!activeId) return;
    setError("");
    const hostelQuery = `hostel_id=${encodeURIComponent(activeId)}`;
    const results = await Promise.allSettled([
      api.get<JsonRecord>(`/owner/reports?${hostelQuery}`),
      api.get<{ hostel: JsonRecord }>(`/owner/hostel?${hostelQuery}`),
      api.get<JsonRecord>(`/owner/subscription?${hostelQuery}`),
      api.get<{ notices: JsonRecord[] }>(`/owner/notices?${hostelQuery}`),
      api.get<{ complaints: JsonRecord[]; requests: JsonRecord[] }>(`/owner/complaints?${hostelQuery}`),
      api.get<{ enquiries: JsonRecord[] }>("/owner/enquiries"),
    ]);
    const errors: string[] = [];
    if (results[0].status === "fulfilled") setReports(results[0].value); else errors.push(results[0].reason.message || "Reports unavailable");
    if (results[1].status === "fulfilled") setHostel(results[1].value.hostel); else errors.push(results[1].reason.message || "Hostel details unavailable");
    if (results[2].status === "fulfilled") setSubscription(results[2].value); else errors.push(results[2].reason.message || "Subscription unavailable");
    if (results[3].status === "fulfilled") setNotices(results[3].value.notices); else errors.push(results[3].reason.message || "Notices unavailable");
    if (results[4].status === "fulfilled") { setComplaints(results[4].value.complaints); setRequests(results[4].value.requests); } else errors.push(results[4].reason.message || "Complaints unavailable");
    if (results[5].status === "fulfilled") setEnquiries(results[5].value.enquiries); else errors.push(results[5].reason.message || "Enquiries unavailable");
    setError(errors.join("; "));
  }, [activeId]);
  useEffect(() => { void load(); }, [load]);
  const postNotice = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeId || !noticeTitle.trim() || !noticeBody.trim()) { setError("Enter both a notice title and message."); return; }
    try {
      await api.post("/owner/notices", { hostel_id: activeId, title: noticeTitle.trim(), body: noticeBody.trim() });
      setNoticeTitle(""); setNoticeBody(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not publish notice."); }
  };
  const deleteNotice = async (id: string) => {
    if (!window.confirm("Delete this notice?")) return;
    try { await api.delete(`/owner/notices/${encodeURIComponent(id)}`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete notice."); }
  };
  const resolveItem = async (kind: "complaints" | "requests", id: string) => {
    try { await api.post(`/owner/${kind}/${encodeURIComponent(id)}/resolve`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not mark item resolved."); }
  };
  const startCheckout = async (plan: JsonRecord) => {
    setCheckout(plan); setQuote(null); setCoins("0"); setError("");
    try {
      const currentQuote = await api.get<JsonRecord>(`/owner/referrals/quote?plan_id=${encodeURIComponent(plan.id)}&requested_coins=0`);
      setQuote(currentQuote);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not quote plan price."); }
  };
  const updateQuote = async () => {
    const count = Number(coins);
    if (!checkout || !Number.isInteger(count) || count < 0) { setError("Enter a non-negative whole number of coins."); return; }
    try {
      setQuote(await api.get<JsonRecord>(`/owner/referrals/quote?plan_id=${encodeURIComponent(checkout.id)}&requested_coins=${count}`));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not calculate plan quote."); }
  };
  const buyPlan = async () => {
    if (!checkout || !quote || !activeId) return;
    const plan = (subscription?.plans || []).find((item: JsonRecord) => item.id === checkout.id);
    if (!plan || !plan.total_amount_paise || !plan.gst_rates?.length) { setError("GST pricing is not configured for this plan."); return; }
    const paymentWindow = window.open("about:blank", "_blank");
    if (!paymentWindow) { setError("The browser blocked the payment window. Allow pop-ups and retry."); return; }
    setBusy("checkout");
    try {
      const result = await api.post<JsonRecord>("/payments/subscription/link", {
        hostel_id: activeId, plan_id: checkout.id, requested_coins: Number(coins),
        expected_coin_discount_paise: quote.discount_paise,
        expected_base_price_paise: plan.base_price_paise,
        expected_gst_rate: plan.gst_rate, expected_gst_rates: plan.gst_rates,
        expected_gst_amount_paise: plan.gst_amount_paise, expected_total_amount_paise: plan.total_amount_paise,
      });
      if (result.total_amount_paise !== plan.total_amount_paise || result.referral_coins !== Number(coins)) {
        throw new Error("Plan pricing or coin discount changed. Refresh and review the current quote before paying.");
      }
      setCheckout(null);
      paymentWindow.opener = null;
      paymentWindow.location.assign(result.checkout_url);
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const status = await api.get<{ activated: boolean }>(`/payments/subscription/status/${encodeURIComponent(result.payment_link_id)}`);
        if (status.activated) { await refresh(); await load(); return; }
      }
      setError("Payment is still being verified. Refresh the subscription status shortly.");
    } catch (reason) { paymentWindow.close(); setError(reason instanceof Error ? reason.message : "Online payment could not be started."); }
    finally { setBusy(""); }
  };
  const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
  const stats = reports || {};
  return <Page title="More" subtitle="Hostel tools, service requests and subscription">
    <ErrorBox error={error} />
    <div className="row">{["overview", "notices", "support", "enquiries", "subscription"].map((item) =>
      <Button key={item} kind={section === item ? "primary" : "secondary"} onClick={() => setSection(section === item ? "" : item)}>{item}</Button>)}</div>
    {!section && <>
      <Card className="stack"><div className="spread"><h2>Hostel summary</h2><Button kind="secondary" onClick={() => setEditHostel(hostel)}>Edit property</Button></div><p>{hostel?.name} · {hostel?.city} · Status: {hostel?.status || "—"}</p><p>Rooms {stats.total_rooms ?? "—"} · Tenants {stats.total_tenants ?? "—"} · Beds {stats.total_beds ?? "—"}</p><p>Collection ₹{stats.total_collection ?? "—"} · Expenses ₹{stats.total_expenses ?? "—"}</p></Card>
      <Card className="stack"><h2>Service activity</h2><p>Pending payment approvals: {stats.pending_payments ?? 0}</p><p>Open complaints: {complaints.filter((item) => item.status !== "resolved").length} · Open requests: {requests.filter((item) => item.status !== "resolved").length}</p><p>New enquiries: {enquiries.length}</p></Card>
    </>}
    {section === "overview" && <Card className="stack"><h2>Property reports</h2>{Object.entries(stats).filter(([, value]) => typeof value !== "object" && value !== undefined).map(([key, value]) => <div className="spread" key={key}><span>{key.replaceAll("_", " ")}</span><b>{String(value)}</b></div>)}</Card>}
    {section === "notices" && <><Card className="stack"><h2>Post a notice</h2><form className="form" onSubmit={(event) => void postNotice(event)}><Field label="Title" value={noticeTitle} onChange={setNoticeTitle} required /><Field label="Message" value={noticeBody} onChange={setNoticeBody} multiline required /><Button type="submit">Post notice</Button></form></Card><Card className="stack"><h2>Notices</h2>{notices.map((item) => <div className="spread" key={item.id}><div><b>{item.title}</b><p>{item.body}</p></div><Button kind="danger" onClick={() => void deleteNotice(item.id)}>Delete</Button></div>)}{!notices.length && <p>No notices.</p>}</Card></>}
    {section === "support" && <><Card className="stack"><h2>Complaints</h2>{complaints.map((item) => <div className="spread" key={item.id}><div><b>{item.title}</b><p>{item.body}</p><span className="badge">{item.status}</span></div>{item.status !== "resolved" && <Button onClick={() => void resolveItem("complaints", item.id)}>Resolve</Button>}</div>)}{!complaints.length && <p>No complaints.</p>}</Card><Card className="stack"><h2>Requests</h2>{requests.map((item) => <div className="spread" key={item.id}><span>{item.type} · {item.note || ""} · {item.status}</span>{item.status !== "resolved" && <Button onClick={() => void resolveItem("requests", item.id)}>Handle request</Button>}</div>)}{!requests.length && <p>No requests.</p>}</Card></>}
    {section === "enquiries" && <Card className="stack"><h2>Public enquiries</h2>{enquiries.map((item) => <article className="card" key={item.id}><b>{item.name} · {item.type}</b><p>{item.mobile} · {item.message}</p><p className="muted small">{item.created_at ? new Date(item.created_at).toLocaleString() : ""} {item.visit_date || ""}</p></article>)}{!enquiries.length && <p>No enquiries.</p>}</Card>}
    {section === "subscription" && <div className="stack">
      <Card className="stack"><h2>Current subscription</h2><p>{subscription?.subscription?.status || subscription?.status || "Free plan"}</p><p>{subscription?.subscription?.expires_at ? `Expires ${new Date(subscription.subscription.expires_at).toLocaleDateString()}` : ""}</p><p>Payments enabled: {subscription?.payments_enabled ? "Yes" : "No"}</p></Card>
      {subscription?.plans?.map((plan: JsonRecord) => <Card className="spread" key={plan.id}><div><b>{plan.name}</b><p>{plan.duration_months} months · Base {money(plan.base_price_paise || 0)} · GST {plan.gst_rates?.join("% + ") || "not configured"}%</p><b>Total {money(plan.total_amount_paise || 0)}</b></div><Button onClick={() => void startCheckout(plan)} disabled={!subscription?.payments_enabled}>Choose plan</Button></Card>)}
      {(subscription?.history || []).length > 0 && <Card className="stack"><h2>Subscription history & invoices</h2>{(subscription?.history || []).map((item: JsonRecord) => <div className="spread" key={item.id}><span>{item.plan_name || item.plan_id} · ₹{item.amount} · {item.status}</span><Button kind="secondary" onClick={() => window.print()}>Print invoice</Button></div>)}</Card>}
    </div>}
    {checkout && <div className="modal-backdrop"><section className="modal"><div className="spread"><h2>Review subscription payment</h2><Button kind="ghost" onClick={() => setCheckout(null)}>Close</Button></div>
      <Card className="stack"><b>{checkout.name}</b><p>Total {quote ? money(quote.total_amount_paise || quote.total_paise || 0) : "Quote loading…"}</p><p>GST: {quote?.gst_amount_paise != null ? money(quote.gst_amount_paise) : "Calculated by the server"}</p><p>Referral coin discount: {quote ? money(quote.discount_paise || 0) : "—"}</p></Card>
      <div className="row"><Field label="Referral coins to redeem" value={coins} onChange={setCoins} type="number" min={0} /><Button kind="secondary" onClick={() => void updateQuote()}>Update quote</Button></div>
      <p className="muted small">Plan total, GST, and coin discounts are verified again by the backend at checkout.</p><Button onClick={() => void buyPlan()} disabled={!quote || !!busy}>{busy === "checkout" ? "Opening secure checkout…" : "Continue to payment"}</Button>
    </section></div>}
    {editHostel && <div className="modal-backdrop"><section className="modal"><PropertyForm initial={editHostel} onDone={() => { setEditHostel(null); void refresh(); void load(); }} /></section></div>}
  </Page>;
}
