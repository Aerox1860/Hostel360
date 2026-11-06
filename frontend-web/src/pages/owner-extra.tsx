import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useOwnerHostel } from "../owner-state";
import { useAuth } from "../state";
import { AlertMessage, Button, Card, Field, Page } from "../ui";
import { PropertyForm } from "./owner";

type JsonRecord = Record<string, any>;
type TenantDocumentKind = "aadhaar_front" | "aadhaar_back" | "selfie";
type ApplicantIdentity = { aadhaar_number: string; documents: Partial<Record<TenantDocumentKind, File>> };

function escapeInvoiceHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] || character);
}

function invoiceDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function ErrorBox({ error }: { error: string }) {
  return error ? <AlertMessage tone="error">{error}</AlertMessage> : null;
}

export function OwnerRegistrationPage() {
  const { activeId, activeHostel } = useOwnerHostel();
  const [registration, setRegistration] = useState<JsonRecord | null>(null);
  const [applications, setApplications] = useState<JsonRecord[]>([]);
  const [rooms, setRooms] = useState<JsonRecord[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, { room_id: string; bed_number: string }>>({});
  const [applicantIdentity, setApplicantIdentity] = useState<Record<string, ApplicantIdentity>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!activeId) {
      setRegistration(null); setApplications([]); setRooms([]); setRoomsLoaded(false); setError(""); setLoading(false);
      return;
    }
    setLoading(true);
    setRoomsLoaded(false);
    const query = `hostel_id=${encodeURIComponent(activeId)}`;
    const results = await Promise.allSettled([
      api.get<{ registration: JsonRecord | null }>(`/owner/tenant-registration-qr?${query}`),
      api.get<{ applications: JsonRecord[] }>(`/owner/tenant-applications?${query}`),
      api.get<{ rooms: JsonRecord[] }>(`/owner/rooms?${query}`),
    ]);
    const errors: string[] = [];
    if (results[0].status === "fulfilled") setRegistration(results[0].value.registration);
    else errors.push(`Registration QR: ${results[0].reason instanceof Error ? results[0].reason.message : "Could not load registration QR."}`);
    if (results[1].status === "fulfilled") setApplications(results[1].value.applications || []);
    else errors.push(`Tenant applications: ${results[1].reason instanceof Error ? results[1].reason.message : "Could not load tenant applications."}`);
    if (results[2].status === "fulfilled") {
      setRooms(results[2].value.rooms || []);
      setRoomsLoaded(true);
    } else errors.push(`Room availability: ${results[2].reason instanceof Error ? results[2].reason.message : "Could not load room availability."}`);
    setError(errors.join(" "));
    setLoading(false);
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
    if (!roomsLoaded) { setError("Room availability is not loaded. Refresh and retry before allocating."); return; }
    const selection = allocations[application.id] || { room_id: "", bed_number: "" };
    if (!selection.room_id || !selection.bed_number) { setError("Select an available room and bed before allocating."); return; }
    const identity = applicantIdentity[application.id] || { aadhaar_number: "", documents: {} };
    const aadhaar = identity.aadhaar_number.replace(/[\s-]/g, "");
    if (identity.aadhaar_number && !/^\d{12}$/.test(aadhaar)) { setError("Enter a valid 12-digit Aadhaar number or clear the field."); return; }
    setBusy(application.id); setError("");
    const staged: string[] = [];
    try {
      const documentRefs: Partial<Record<TenantDocumentKind, string>> = {};
      if (application.status !== "allocating") {
        for (const kind of ["aadhaar_front", "aadhaar_back", "selfie"] as const) {
          const file = identity.documents[kind];
          if (!file) continue;
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
            throw new Error("Identity documents must be JPG, PNG or WebP images no larger than 10 MB.");
          }
          const result = await api.upload<{ upload_id: string }>(`/owner/tenant-documents?hostel_id=${encodeURIComponent(activeId)}&kind=${kind}`, file);
          documentRefs[kind] = result.upload_id;
          staged.push(result.upload_id);
        }
      }
      await api.post(`/owner/tenant-applications/${encodeURIComponent(application.id)}/allocation`, {
        ...selection,
        ...(application.status === "allocating" ? {} : {
          aadhaar_number: aadhaar || undefined,
          documents: documentRefs,
        }),
      });
      setApplicantIdentity((current) => {
        const next = { ...current };
        delete next[application.id];
        return next;
      });
      await load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Allocation failed. The application remains available to retry.";
      const cleanup = await Promise.allSettled(staged.map((id) => api.delete(`/owner/tenant-documents/${encodeURIComponent(id)}`)));
      setError(cleanup.some((result) => result.status === "rejected") ? `${message} Some temporary identity uploads could not be cleaned up.` : message);
    }
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
    const title = activeHostel?.name || "Tenant registration";
    if (navigator.canShare && registration.qr_data_uri) {
      try {
        const response = await fetch(registration.qr_data_uri);
        const blob = await response.blob();
        const qrFile = new File([blob], "hostel360-tenant-registration.png", { type: blob.type || "image/png" });
        if (navigator.canShare({ files: [qrFile] })) {
          try {
            await navigator.share({
              title,
              text: `Scan this QR code or open the tenant registration link: ${registration.registration_url}`,
              files: [qrFile],
            });
            return;
          } catch (reason) {
            if (reason instanceof Error && reason.name === "AbortError") return;
          }
        }
      } catch {
        // Fall back to sharing the public registration link.
      }
    }
    try { await navigator.share({ title, url: registration.registration_url }); }
    catch (reason) { if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message); }
  };
  const freeBeds = (room: JsonRecord) => (room.beds || []).filter((bed: JsonRecord) => bed.status !== "occupied" && !bed.tenant_id);
  return <Page title="Tenant registration" subtitle={`${activeHostel?.name || "Selected hostel"} · QR links and applications`}>
    <ErrorBox error={error} />
    <div className="row"><Button kind="secondary" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh registration and applications"}</Button></div>
    <Card className="stack"><h2>Registration QR</h2><p>Each hostel has one saved registration QR. Generate displays the existing QR when available; revoke it explicitly before creating a replacement.</p>
      {registration ? <>
        <img className="registration-qr" src={registration.qr_data_uri} alt={`Tenant registration QR for ${activeHostel?.name || "hostel"}`} />
        <p className="small">{registration.registration_url}</p><p className="muted small">Expires {registration.expires_at ? new Date(registration.expires_at).toLocaleString() : "according to current policy"}</p>
        <div className="row"><Button kind="secondary" onClick={() => void copyLink()}>Copy link</Button><Button kind="secondary" onClick={() => void shareLink()}>Share link</Button><a className="button secondary" href={registration.qr_data_uri} download="hostel360-tenant-registration.png">Download QR</a><Button kind="secondary" onClick={printQr}>Print</Button><Button kind="danger" onClick={() => void qrAction("revoke")} disabled={!!busy}>Revoke QR</Button></div>
      </> : <Button onClick={() => void qrAction("generate")} disabled={loading || !!busy}>{loading ? "Checking saved QR…" : busy === "generate" ? "Generating…" : "Generate QR code"}</Button>}
    </Card>
    <Card className="stack"><h2>Tenant applications ({applications.length})</h2>{applications.map((application) => <article className="card stack" key={application.id}>
      <div className="spread"><b>{application.name}</b><span className="badge">{application.status}</span></div>
      <p>{application.mobile} · {application.email || "No email"} · {application.preferences || "No preferences"}</p><p className="muted small">{application.created_at ? new Date(application.created_at).toLocaleString() : ""}</p>
      {(application.address || application.joining_date) && <p>{application.address || "No address provided"}{application.joining_date ? ` · Joining ${application.joining_date}` : ""}</p>}
      {application.status === "pending" && <div className="row"><Button onClick={() => void updateApplication(application, "approved")} disabled={!!busy}>Approve</Button><Button kind="danger" onClick={() => void updateApplication(application, "rejected")} disabled={!!busy}>Reject</Button></div>}
      {["approved", "allocating"].includes(application.status) && <div className="stack">
        <div className="form grid-form">
          <Field label="Room" value={allocations[application.id]?.room_id || application.allocation_room_id || ""} onChange={(value) => setAllocations((current) => ({ ...current, [application.id]: { room_id: value, bed_number: "" } }))} options={rooms.filter((room) => freeBeds(room).length).map((room) => room.id)} optionLabels={Object.fromEntries(rooms.map((room) => [room.id, `Room ${room.room_number}`]))} />
          <Field label="Bed" value={allocations[application.id]?.bed_number || application.allocation_bed_number || ""} onChange={(value) => setAllocations((current) => ({ ...current, [application.id]: { room_id: current[application.id]?.room_id || application.allocation_room_id || "", bed_number: value } }))} options={freeBeds(rooms.find((room) => room.id === (allocations[application.id]?.room_id || application.allocation_room_id)) || {}).map((bed: JsonRecord) => String(bed.bed_number))} />
        </div>{!roomsLoaded && <p className="muted small">Room availability must load before allocation.</p>}
        <p className="muted small">Collect identity details securely after approval. Uploaded documents are encrypted by the existing tenant-document service.</p>
        <Field label="Aadhaar number (optional)" value={applicantIdentity[application.id]?.aadhaar_number || ""} onChange={(value) => setApplicantIdentity((current) => ({ ...current, [application.id]: { aadhaar_number: value, documents: current[application.id]?.documents || {} } }))} maxLength={14} />
        {(["aadhaar_front", "aadhaar_back", "selfie"] as const).map((kind) => <label className="field" key={kind}><span>{kind.replace("_", " ")} (optional)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setApplicantIdentity((current) => ({ ...current, [application.id]: { aadhaar_number: current[application.id]?.aadhaar_number || "", documents: { ...current[application.id]?.documents, [kind]: event.target.files?.[0] } } }))} /></label>)}
        <Button onClick={() => void allocate(application)} disabled={!!busy || !roomsLoaded}>{busy === application.id ? "Creating tenant…" : "Allocate and create tenant"}</Button>
      </div>}
    </article>)}{!applications.length && <p>No applications yet.</p>}</Card>
  </Page>;
}

export function OwnerAlertsPage() {
  const { activeId } = useOwnerHostel();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<JsonRecord[]>([]);
  const [error, setError] = useState("");
  const [selectedReport, setSelectedReport] = useState<{ report: JsonRecord; grantId: string | null } | null>(null);
  const [openingReportId, setOpeningReportId] = useState("");
  const [openingEvidenceId, setOpeningEvidenceId] = useState("");
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
  const openReport = async (notification: JsonRecord) => {
    if (!notification.report_id) return;
    setOpeningReportId(notification.id); setError("");
    try {
      const grantId = notification.grant_id || null;
      const query = grantId ? `?grant_id=${encodeURIComponent(grantId)}` : "";
      const result = await api.get<{ report: JsonRecord }>(
        `/owner/tenant-history/reports/${encodeURIComponent(notification.report_id)}${query}`,
      );
      setSelectedReport({ report: result.report, grantId });
      if (!notification.read_at) await markRead(notification.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open report details."); }
    finally { setOpeningReportId(""); }
  };
  const openEvidence = async (evidence: JsonRecord) => {
    if (!selectedReport || !evidence.id || openingEvidenceId) return;
    setOpeningEvidenceId(evidence.id); setError("");
    try {
      const query = selectedReport.grantId ? `?grant_id=${encodeURIComponent(selectedReport.grantId)}` : "";
      const blob = await api.getBlob(
        `/owner/tenant-reports/${encodeURIComponent(selectedReport.report.id)}/evidence/${encodeURIComponent(evidence.id)}${query}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = String(evidence.filename || "").replace(/[^A-Za-z0-9._-]/g, "_") || "tenant-report-evidence";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open private evidence."); }
    finally { setOpeningEvidenceId(""); }
  };
  const openPayment = async (notification: JsonRecord) => {
    if (!notification.payment_id) return;
    if (!notification.read_at) await markRead(notification.id);
    navigate(`/owner/money?tab=approvals&payment_id=${encodeURIComponent(notification.payment_id)}`);
  };
  const paymentStatus = (status?: string) => {
    if (status === "pending_owner_approval" || status === "approval_processing") return "Pending Owner Approval";
    if (status === "paid") return "Approved";
    if (status === "rejected") return "Rejected";
    return status?.replaceAll("_", " ") || "Status unavailable";
  };
  return <Page title="Alerts" subtitle={`${notifications.filter((item) => !item.read_at).length} unread`}>
    <ErrorBox error={error} />
    {selectedReport && <Card className="stack">
      <div className="spread"><h2>{selectedReport.report.previous_hostel || "Previous hostel report"}</h2><Button kind="ghost" onClick={() => setSelectedReport(null)}>Close</Button></div>
      <b>{selectedReport.report.title || selectedReport.report.category || "Tenant report"}</b>
      {selectedReport.report.status && <span className="badge">{selectedReport.report.status.replaceAll("_", " ")}</span>}
      {selectedReport.report.created_at && <p className="muted small">Reported {new Date(selectedReport.report.created_at).toLocaleDateString()}</p>}
      {selectedReport.report.amount_claimed != null && <p>Claimed: ₹{selectedReport.report.amount_claimed} · Outstanding: ₹{selectedReport.report.outstanding_balance ?? selectedReport.report.amount_claimed}</p>}
      {selectedReport.report.description && <p>{selectedReport.report.description}</p>}
      {selectedReport.report.tenant_response?.text && <p className="muted">Tenant response: {selectedReport.report.tenant_response.text}</p>}
      {(selectedReport.report.evidence_documents || []).map((evidence: JsonRecord) =>
        <Button key={evidence.id} kind="secondary" onClick={() => void openEvidence(evidence)} disabled={!!openingEvidenceId}>
          {openingEvidenceId === evidence.id ? "Opening evidence…" : `Download private evidence: ${evidence.filename || "document"}`}
        </Button>,
      )}
    </Card>}
    <Card className="stack">{notifications.map((item) => <article className="spread" key={item.id}>
      <div className="stack">
        <b>{item.event?.replaceAll("_", " ") || item.message || "Hostel notification"}</b>
        <p className="muted small">{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</p>
        {item.payment_id ? <>
          <p>{item.tenant_name || "Tenant"} · Room {item.room_number || "—"}</p>
          <p>Amount: ₹{item.amount ?? 0} · Method: {item.method?.replaceAll("_", " ") || "—"}</p>
          <p>UTR / Transaction reference: {item.upi_reference || "—"}</p>
          <p>Submitted: {item.payment_submitted_at ? new Date(item.payment_submitted_at).toLocaleString() : item.created_at ? new Date(item.created_at).toLocaleString() : "Date unavailable"}</p>
          <span className={`badge ${item.status === "rejected" ? "error" : item.status === "paid" ? "success" : item.status === "pending_owner_approval" || item.status === "approval_processing" ? "warning" : ""}`}>{paymentStatus(item.status)}</span>
          {item.rejection_reason && <p>Rejection reason: {item.rejection_reason}</p>}
          {item.message && <p>{item.message}</p>}
        </> : <>
          {item.message && item.event && <p>{item.message}</p>}
          {item.status && <span className="badge">{item.status}</span>}
        </>}
        {!item.read_at && <Button kind="secondary" onClick={() => void markRead(item.id)}>Mark read</Button>}
        {item.payment_id && <Button kind="secondary" onClick={() => void openPayment(item)}>View Payment</Button>}
        {!item.payment_id && item.report_id && <Button kind="secondary" onClick={() => void openReport(item)} disabled={!!openingReportId}>
          {openingReportId === item.id ? "Opening report…" : "View report details"}
        </Button>}
      </div>
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
  const share = async () => {
    if (!data) return;
    if (!navigator.share) { setError("Sharing is unavailable in this browser; use Copy code, Copy link, or WhatsApp."); return; }
    try {
      await navigator.share({
        title: "Hostel360 referral",
        text: `Join Hostel360 with my referral code ${data.referral_code}: ${data.referral_link}`,
        url: data.referral_link,
      });
    } catch (reason) {
      if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message || "Could not open the share menu.");
    }
  };
  const shareWhatsApp = () => {
    if (!data) return;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`Join Hostel360 with my referral code ${data.referral_code}: ${data.referral_link}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };
  return <Page title="Refer & Earn" subtitle="Subscription coins, not cash">
    <ErrorBox error={error} />
    {!data ? <Button kind="secondary" onClick={() => void load()}>Retry</Button> : <>
      <Card className="stack"><span className="muted">Your referral code</span><div className="stat">{data.referral_code}</div><p>{data.referral_link}</p>
        <div className="row"><Button kind="secondary" onClick={() => void copy(data.referral_code)}>Copy code</Button><Button kind="secondary" onClick={() => void copy(data.referral_link)}>Copy link</Button><Button onClick={() => void share()}>Share</Button><Button kind="secondary" onClick={shareWhatsApp}>WhatsApp</Button></div>
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
  const { activeId, activeHostel, refresh } = useOwnerHostel();
  const { user } = useAuth();
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
  const printInvoice = (item: JsonRecord) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) { setError("The browser blocked the invoice window. Allow pop-ups and retry."); return; }
    const amount = Number(item.amount ?? 0);
    const grossAmount = item.gross_amount_paise != null
      ? Number(item.gross_amount_paise) / 100
      : Number(item.total_amount ?? amount);
    const discount = Number(item.coin_discount_paise ?? 0) / 100;
    const safeMoney = (value: number) => Number.isFinite(value) ? value.toFixed(2) : "0.00";
    const method = String(item.method || "online").toUpperCase();
    const hostelName = subscription?.hostel_name || activeHostel?.name || "";
    const discountRow = discount > 0
      ? `<tr><td><b>Referral subscription coin discount</b><br><span class="muted">${escapeInvoiceHtml(item.referral_coins || 0)} subscription coins applied</span></td><td></td><td class="amount">−₹${escapeInvoiceHtml(safeMoney(discount))}</td></tr>`
      : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Subscription invoice</title><style>
        body{font-family:Arial,sans-serif;color:#1a1d1a;padding:32px;background:#fff}
        .row{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
        .brand{font-size:22px;font-weight:800;color:#2c5e3e}
        .title{font-size:22px;font-weight:800}.accent{color:#d97706}
        .muted{color:#6a706a;font-size:13px}
        .box{background:#f4f5f4;border-radius:12px;padding:16px;margin-top:24px}
        table{width:100%;border-collapse:collapse;margin-top:24px}
        th{text-align:left;font-size:12px;color:#6a706a;border-bottom:2px solid #e5e7e5;padding:10px 8px;text-transform:uppercase}
        td{padding:14px 8px;border-bottom:1px solid #e5e7e5;font-size:14px}
        .amount{text-align:right;font-weight:700}
        .total{display:flex;justify-content:flex-end;margin-top:20px}
        .total strong{font-size:26px;color:#2c5e3e}
        .badge{display:inline-block;background:#e3ece5;color:#1d402a;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;margin-top:6px}
        .footer{margin-top:40px;border-top:1px solid #e5e7e5;padding-top:16px;font-size:12px;color:#6a706a}
        @media print{body{padding:16px}}
      </style></head><body>
        <div class="row"><div><div class="brand">Hostel <span class="accent">360</span></div><div class="muted">Subscription Invoice</div></div>
          <div style="text-align:right"><b>${escapeInvoiceHtml(item.invoice_no || "INV-—")}</b><div class="muted">Date: ${escapeInvoiceHtml(invoiceDate(item.created_at))}</div><span class="badge">PAID · ${escapeInvoiceHtml(method)}</span></div>
        </div>
        <section class="box"><div class="muted">Billed to</div><b>${escapeInvoiceHtml(user?.name || "")}</b><div class="muted">${escapeInvoiceHtml(hostelName)}</div></section>
        <table><thead><tr><th>Description</th><th>Period</th><th style="text-align:right">Amount</th></tr></thead><tbody>
          <tr><td><b>${escapeInvoiceHtml(item.plan_name || "Plan")}</b><br><span class="muted">${escapeInvoiceHtml(item.months || 1)} month(s) premium subscription, including applicable taxes</span></td>
            <td>${escapeInvoiceHtml(invoiceDate(item.start))}<br><span class="muted">to ${escapeInvoiceHtml(invoiceDate(item.end))}</span></td>
            <td class="amount">₹${escapeInvoiceHtml(safeMoney(grossAmount))}</td></tr>
          ${discountRow}
        </tbody></table>
        <div class="total"><div style="text-align:right"><div class="muted">Total Paid</div><strong>₹${escapeInvoiceHtml(safeMoney(amount))}</strong></div></div>
        <footer class="footer">Thank you for choosing Hostel 360. This is a computer-generated invoice and does not require a signature.<br>For support, contact your Hostel 360 administrator.</footer>
      </body></html>`;
    try {
      printWindow.opener = null;
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      window.setTimeout(() => {
        try { printWindow.print(); }
        catch { setError("Could not open the print dialog for this invoice."); }
      }, 500);
    } catch {
      printWindow.close();
      setError("Could not generate the invoice.");
    }
  };
  const stats = reports || {};
  const subscriptionPlans: JsonRecord[] = subscription?.plans || [];
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
      {subscriptionPlans.length > 0 && <div className="grid subscription-plan-grid owner-plan-grid">
        {subscriptionPlans.map((plan: JsonRecord) => {
          return <Card className="stack subscription-plan-card owner-plan-card" key={plan.id}>
            <div className="subscription-plan-heading">
              <span className="subscription-plan-icon" aria-hidden="true">✦</span>
              <div className="subscription-plan-title"><h3>{plan.name}</h3><p>{plan.duration_months} {Number(plan.duration_months) === 1 ? "month" : "months"}</p></div>
            </div>
            <div className="subscription-plan-price">{money(plan.base_price_paise || 0)}</div>
            <p className="subscription-plan-tax">GST {plan.gst_rates?.length ? `${plan.gst_rates.join("% + ")}%` : "not configured"}{plan.gst_amount_paise != null ? ` · ${money(plan.gst_amount_paise)}` : ""}</p>
            <div className="subscription-plan-total"><span>Total including GST</span><b>{money(plan.total_amount_paise || 0)}</b></div>
            <div className="subscription-plan-features">
              {(plan.features || []).map((feature: string) => <p key={feature}><span aria-hidden="true">✓</span>{feature}</p>)}
            </div>
            <Button onClick={() => void startCheckout(plan)} disabled={!subscription?.payments_enabled}>Choose Plan <span aria-hidden="true">→</span></Button>
          </Card>;
        })}
      </div>}
      {(subscription?.history || []).length > 0 && <Card className="stack"><h2>Subscription history & invoices</h2>{(subscription?.history || []).map((item: JsonRecord) => <div className="spread" key={item.id}><span>{item.plan_name || item.plan_id} · {item.invoice_no || "—"} · ₹{item.amount} · {item.status}</span><Button kind="secondary" onClick={() => printInvoice(item)}>Download Invoice</Button></div>)}</Card>}
    </div>}
    {checkout && <div className="modal-backdrop"><section className="modal"><div className="spread"><h2>Review subscription payment</h2><Button kind="ghost" onClick={() => setCheckout(null)}>Close</Button></div>
      <Card className="stack"><b>{checkout.name}</b><p>Total {quote ? money(quote.total_amount_paise || quote.total_paise || 0) : "Quote loading…"}</p><p>GST: {quote?.gst_amount_paise != null ? money(quote.gst_amount_paise) : "Calculated by the server"}</p><p>Referral coin discount: {quote ? money(quote.discount_paise || 0) : "—"}</p></Card>
      <div className="row"><Field label="Referral coins to redeem" value={coins} onChange={setCoins} type="number" min={0} /><Button kind="secondary" onClick={() => void updateQuote()}>Update quote</Button></div>
      <p className="muted small">Plan total, GST, and coin discounts are verified again by the backend at checkout.</p><Button onClick={() => void buyPlan()} disabled={!quote || !!busy}>{busy === "checkout" ? "Opening secure checkout…" : "Continue to payment"}</Button>
    </section></div>}
    {editHostel && <div className="modal-backdrop"><section className="modal"><PropertyForm initial={editHostel} onDone={() => { setEditHostel(null); void refresh(); void load(); }} /></section></div>}
  </Page>;
}
