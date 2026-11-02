import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AdvertisementSlot } from "../ads";
import { useOwnerHostel } from "../owner-state";
import { AlertMessage, Button, Card, Field, Page } from "../ui";

function OwnerError({ value }: { value: string }) {
  return value ? <AlertMessage tone="error">{value}</AlertMessage> : null;
}

export function PropertyForm({ initial, onDone }: { initial?: Record<string, any>; onDone: () => void }) {
  const [values, setValues] = useState({
    name: initial?.name || "",
    pg_name: initial?.pg_name || "",
    owner_name: initial?.owner_name || "",
    mobile: initial?.mobile || "",
    address: initial?.address || "",
    city: initial?.city || "",
    state: initial?.state || "",
    area: initial?.area || "",
    google_location: initial?.google_location || "",
    gender: initial?.gender || "pg",
    property_type: initial?.property_type || "",
    amenities: (initial?.amenities || ["Wi-Fi", "Food"]) as string[],
    photos: (initial?.photos || []) as string[],
    signature: initial?.signature || null,
    upi_id: initial?.upi_id || "",
    upi_qr_code: initial?.upi_qr_code || null,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (key: string, value: unknown) => setValues((current) => ({ ...current, [key]: value }));
  const selectImage = (event: ChangeEvent<HTMLInputElement>, key: "photos" | "signature" | "upi_qr_code") => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (key === "upi_qr_code" && file.size > 1_000_000) {
      setError("UPI QR images must be 1 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      if (key === "photos") update("photos", [...values.photos, data].slice(0, 8));
      else update(key, data);
    };
    reader.onerror = () => setError("Could not read the selected image.");
    reader.readAsDataURL(file);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!values.name || !values.owner_name || !values.mobile || !values.address || !values.city || !values.state || !values.property_type) {
      setError("Fill all required fields and select a property type.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = { ...values, upi_id: values.upi_id.trim() || null, upi_qr_code: values.upi_qr_code, sharing_types: initial?.sharing_types || [] };
      if (initial?.id) await api.put(`/owner/hostel/${encodeURIComponent(initial.id)}`, body);
      else await api.post("/owner/hostel", body);
      onDone();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save hostel."); }
    finally { setBusy(false); }
  };
  const amenities = ["Wi-Fi", "Food", "Parking", "Laundry", "CCTV", "AC", "Gym", "Power Backup"];
  return <form className="form" onSubmit={(event) => void submit(event)}>
    <div className="form grid-form">
      {([
        ["name", "Hostel name", true], ["pg_name", "PG / Brand name", false], ["owner_name", "Owner name", true],
        ["mobile", "Mobile number", true], ["address", "Full address", true], ["city", "City", true], ["state", "State", true],
        ["area", "Area / Locality", false], ["google_location", "Google Maps location (lat,lng)", false], ["upi_id", "UPI ID", false],
      ] as const).map(([key, label, required]) =>
        <Field key={key} label={label} value={values[key] || ""} onChange={(value) => update(key, value)} required={required} type={key === "mobile" ? "tel" : "text"} />)}
      <Field label="Hostel type" value={values.gender} onChange={(value) => update("gender", value)} options={["pg", "boys", "girls", "co-living"]} />
      <Field label="Property type" value={values.property_type} onChange={(value) => update("property_type", value)} options={["PG", "Hostel", "Co-living", "Apartment"]} required />
    </div>
    <div><b>Amenities</b><div className="tag-row">{amenities.map((item) =>
      <label className="badge" key={item}><input type="checkbox" checked={values.amenities.includes(item)} onChange={(event) => update("amenities", event.target.checked ? [...values.amenities, item] : values.amenities.filter((value) => value !== item))} /> {item}</label>)}</div></div>
    <input aria-label="Select hostel photos" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => {
      const files = Array.from(event.target.files || []);
      files.slice(0, 8 - values.photos.length).forEach((file) => {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Choose JPG, PNG, or WebP images."); return; }
        const reader = new FileReader();
        reader.onload = () => update("photos", [...values.photos, String(reader.result)].slice(0, 8));
        reader.readAsDataURL(file);
      });
    }} />
    <div className="tag-row">{values.photos.map((photo, index) => <img key={index} src={photo} alt={`Hostel photo ${index + 1}`} width="76" height="76" />)}</div>
    <label className="field"><span>Owner signature (printed on tenant rent receipts)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectImage(event, "signature")} /></label>
    <label className="field"><span>UPI QR code (JPG, PNG or WebP; up to 1 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectImage(event, "upi_qr_code")} /></label>
    {error && <AlertMessage tone="error">{error}</AlertMessage>}
    <div className="row"><Button type="submit" disabled={busy}>{busy ? "Saving…" : initial?.id ? "Save hostel" : "Submit hostel for verification"}</Button><Button kind="ghost" onClick={onDone}>Cancel</Button></div>
  </form>;
}

function HostelSelect() {
  const { hostels, activeId, setActiveId } = useOwnerHostel();
  return hostels.length > 1 ? <Field label="Selected hostel" value={activeId} onChange={setActiveId} options={hostels.map((item) => item.id)} optionLabels={Object.fromEntries(hostels.map((item) => [item.id, item.name]))} /> : null;
}

function useHostelData<T>(path: string, initial: T) {
  const { activeId } = useOwnerHostel();
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [initialValue] = useState(initial);
  const load = useCallback(async () => {
    if (!activeId) { setData(initialValue); setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const result = await api.get<T>(`${path}${path.includes("?") ? "&" : "?"}hostel_id=${encodeURIComponent(activeId)}`);
      setData(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load this information."); }
    finally { setLoading(false); }
  }, [activeId, initialValue, path]);
  useEffect(() => { void load(); }, [load]);
  return { data, setData, error, setError, loading, load };
}

export function OwnerDashboardPage() {
  const { activeId, activeHostel, hostels, error: hostelError, loading: hostelsLoading, refresh } = useOwnerHostel();
  const dashboard = useHostelData<Record<string, any>>("/owner/dashboard", {});
  const [portfolio, setPortfolio] = useState<Record<string, any> | null>(null);
  const [portfolioError, setPortfolioError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editHostel, setEditHostel] = useState<Record<string, any> | undefined>();
  const loadPortfolio = useCallback(async () => {
    try { setPortfolio(await api.get<Record<string, any>>("/owner/portfolio")); setPortfolioError(""); }
    catch (reason) { setPortfolioError(reason instanceof Error ? reason.message : "Could not load portfolio summary."); }
  }, []);
  useEffect(() => { void loadPortfolio(); }, [loadPortfolio, hostels]);

  if (hostelsLoading) return <Page title="Dashboard"><p className="muted">Loading your properties…</p></Page>;
  if (hostelError) return <Page title="Dashboard"><OwnerError value={hostelError} /><Button kind="secondary" onClick={() => void refresh()}>Retry</Button></Page>;
  if (hostels.length === 0) return <Page title="Get started" subtitle="Create your property to start managing rooms, tenants, rent and more.">
    <Card className="stack"><p>Add your first hostel. You can manage multiple hostels with the same owner account.</p><Button onClick={() => setShowForm(true)}>Add Property</Button></Card>
    {showForm && <Card><PropertyForm onDone={() => { setShowForm(false); void refresh(); }} /></Card>}
  </Page>;
  return <Page title="Dashboard" subtitle={activeHostel?.name || "Owner overview"} actions={<><HostelSelect /><Button kind="secondary" onClick={async () => {
    try {
      const result = await api.get<{ hostel: Record<string, any> }>(`/owner/hostel?hostel_id=${encodeURIComponent(activeId)}`);
      setEditHostel(result.hostel); setShowForm(true);
    } catch (reason) { dashboard.setError(reason instanceof Error ? reason.message : "Could not load hostel details."); }
  }}>Edit Hostel</Button></>}>
    <OwnerError value={dashboard.error || portfolioError} />
    <AdvertisementSlot />
    {dashboard.loading ? <p className="muted">Loading dashboard…</p> : <div className="stack">
      {dashboard.data.hostel_status && <Card><span className={`badge ${dashboard.data.hostel_status === "approved" ? "success" : "warning"}`}>{dashboard.data.hostel_status === "approved" ? "Live" : dashboard.data.hostel_status}</span><p className="muted">Listing status</p></Card>}
      {dashboard.data.subscription && <Card className="spread"><div><b>Subscription</b><p>{dashboard.data.subscription.status} · {dashboard.data.subscription.days_left} days left</p></div><Link className="button secondary" to="/owner/more">Manage</Link></Card>}
      <div className="grid">
        {[
          ["Monthly Collection", dashboard.data.monthly_collection],
          ["Expenses", dashboard.data.monthly_expenses],
          ["Net Profit", dashboard.data.net_profit],
          ["Occupancy", `${dashboard.data.occupancy_pct ?? 0}%`],
          ["Rooms", dashboard.data.total_rooms],
          ["Tenants", dashboard.data.total_tenants],
          ["Vacant Beds", dashboard.data.available_beds],
          ["Pending Payments", dashboard.data.pending_payments],
        ].map(([label, value]) => <Card key={String(label)}><span className="muted">{label}</span><div className="stat">{value === undefined ? "—" : typeof value === "number" && String(label).includes("Collection") || String(label).includes("Expenses") ? `₹${value}` : value}</div></Card>)}
      </div>
      {portfolio && portfolio.total_hostels > 1 && <Card className="stack"><h2>All Properties</h2><p>{portfolio.total_hostels} hostels · {portfolio.total_tenants} tenants · {portfolio.total_beds} beds</p><p>Net profit ₹{portfolio.net_profit} · Occupancy {portfolio.occupancy_pct}%</p><p>Collected ₹{portfolio.total_collection} · Spent ₹{portfolio.total_expenses}</p><p>Personal expenses (separate): ₹{portfolio.personal_expenses || 0}</p><p>Unclassified legacy expenses: ₹{portfolio.unclassified_expenses || 0}</p></Card>}
      <Card><h2>Quick actions</h2><div className="row">{[
        ["Rooms & Beds", "/owner/rooms"], ["Tenants", "/owner/tenants"], ["Rent & Expenses", "/owner/money"],
        ["More", "/owner/more"], ["Tenant registration", "/owner/tenant-registration"], ["Rules", "/owner/rules"],
      ].map(([label, path]) => <Link className="button secondary" key={path} to={path}>{label}</Link>)}</div></Card>
    </div>}
    {showForm && <div className="modal-backdrop"><section className="modal"><PropertyForm initial={editHostel} onDone={() => { setShowForm(false); setEditHostel(undefined); void refresh(); void dashboard.load(); }} /></section></div>}
  </Page>;
}

export function OwnerRoomsPage() {
  const { activeId, activeHostel } = useOwnerHostel();
  const [rooms, setRooms] = useState<Record<string, any>[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [floor, setFloor] = useState("");
  const [number, setNumber] = useState("");
  const [rent, setRent] = useState("");
  const [beds, setBeds] = useState("2");
  const load = useCallback(async () => {
    if (!activeId) return setRooms([]);
    try { setRooms((await api.get<{ rooms: Record<string, any>[] }>(`/owner/rooms?hostel_id=${encodeURIComponent(activeId)}`)).rooms); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load rooms."); }
  }, [activeId]);
  useEffect(() => { void load(); }, [load]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!floor.trim() || !number.trim() || !rent || !/^[1-7]$/.test(beds)) { setError("Fill floor, room number and rent. Beds must be a whole number from 1 to 7."); return; }
    try {
      await api.post("/owner/rooms", { hostel_id: activeId, floor: floor.trim(), room_number: number.trim(), rent: parseInt(rent, 10) || 0, bed_count: Number(beds) });
      setOpen(false); setFloor(""); setNumber(""); setRent(""); setBeds("2"); setError(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add room."); }
  };
  const remove = async (room: Record<string, any>) => {
    const occupied = (room.beds || []).some((bed: Record<string, any>) => bed.status === "occupied" || bed.tenant_id);
    if (occupied || !window.confirm(`Delete Room ${room.room_number}?`)) return;
    try { await api.delete(`/owner/rooms/${encodeURIComponent(room.id)}`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete room."); }
  };
  return <Page title="Rooms & Beds" subtitle={`${activeHostel?.name || "Hostel"} · ${rooms.length} rooms · ${rooms.reduce((sum, item) => sum + (item.beds?.length || 0), 0)} beds`} actions={<Button onClick={() => setOpen(true)}>Add Room</Button>}>
    <OwnerError value={error} />
    <div className="grid">{rooms.map((room) => {
      const roomBeds = room.beds || [];
      const occupied = roomBeds.filter((bed: Record<string, any>) => bed.status === "occupied").length;
      return <Card className="stack" key={room.id}>
        <div className="spread"><div><h2>Room {room.room_number}</h2><span className="muted">Floor {room.floor} · {room.bed_count ?? roomBeds.length} beds</span></div><div><b>₹{room.rent}</b><p><span className={`badge ${occupied === roomBeds.length ? "error" : "success"}`}>{occupied}/{roomBeds.length} filled</span></p></div></div>
        <div className="tag-row">{roomBeds.map((bed: Record<string, any>) => <span className={`badge ${bed.status === "occupied" ? "warning" : "success"}`} key={bed.bed_number}>Bed {bed.bed_number} · {bed.status}</span>)}</div>
        {!occupied && <Button kind="danger" onClick={() => void remove(room)}>Delete room</Button>}
      </Card>;
    })}</div>
    {!rooms.length && <Card><p>No rooms yet. Add rooms and beds to start allocating tenants.</p></Card>}
    {open && <div className="modal-backdrop"><section className="modal"><div className="spread"><h2>Add Room</h2><Button kind="ghost" onClick={() => setOpen(false)}>Close</Button></div>
      <form className="form" onSubmit={(event) => void save(event)}>
        <div className="form grid-form"><Field label="Floor" value={floor} onChange={setFloor} placeholder="1" required /><Field label="Room number" value={number} onChange={setNumber} placeholder="101" required />
          <Field label="Monthly rent" value={rent} onChange={setRent} type="number" min={0} required />
          <Field label="Number of beds" value={beds} onChange={setBeds} options={["1", "2", "3", "4", "5", "6", "7"]} /></div>
        {error && <AlertMessage tone="error">{error}</AlertMessage>}<Button type="submit">Add Room</Button>
      </form>
    </section></div>}
  </Page>;
}

type FoodProduct = { product_name: string; quantity: string; amount: string };
const DEFAULT_EXPENSES = ["electricity", "water", "internet", "gas", "staff_salary", "food", "maintenance", "repairs", "other"];

export function OwnerTenantsPage() {
  const { activeId } = useOwnerHostel();
  const [tenants, setTenants] = useState<Record<string, any>[]>([]);
  const [rooms, setRooms] = useState<Record<string, any>[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Record<string, any> | null>(null);
  const [detail, setDetail] = useState<Record<string, any> | null>(null);
  const [reports, setReports] = useState<Record<string, any>[]>([]);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [roomId, setRoomId] = useState("");
  const [bed, setBed] = useState("");
  const [rent, setRent] = useState("");
  const [deposit, setDeposit] = useState("0");
  const [advance, setAdvance] = useState("0");
  const [joiningDate, setJoiningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [aadhaar, setAadhaar] = useState("");
  const [aadhaarStatus, setAadhaarStatus] = useState("");
  const [historyCode, setHistoryCode] = useState("");
  const [historyGrantId, setHistoryGrantId] = useState("");
  const [historyReports, setHistoryReports] = useState<Record<string, any>[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [createLogin, setCreateLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [documents, setDocuments] = useState<Record<string, File | null>>({ aadhaar_front: null, aadhaar_back: null, selfie: null });
  const [reportCategory, setReportCategory] = useState("unpaid_rent");
  const [reportAmount, setReportAmount] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportEvidenceSummary, setReportEvidenceSummary] = useState("");
  const [reportEvidence, setReportEvidence] = useState<File | null>(null);
  const [settlementAmounts, setSettlementAmounts] = useState<Record<string, string>>({});
  const [transferRoom, setTransferRoom] = useState("");
  const [transferBed, setTransferBed] = useState("");

  const load = useCallback(async () => {
    if (!activeId) { setTenants([]); setRooms([]); return; }
    try {
      const hostelId = encodeURIComponent(activeId);
      const [tenantResult, roomResult] = await Promise.all([
        api.get<{ tenants: Record<string, any>[] }>(`/owner/tenants?hostel_id=${hostelId}`),
        api.get<{ rooms: Record<string, any>[] }>(`/owner/rooms?hostel_id=${hostelId}`),
      ]);
      setTenants(tenantResult.tenants); setRooms(roomResult.rooms); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load tenants."); }
  }, [activeId]);
  useEffect(() => { void load(); }, [load]);

  const freeBeds = (room: Record<string, any>) => (room.beds || []).filter((item: Record<string, any>) => item.status !== "occupied" && !item.tenant_id);
  const selectedRoom = rooms.find((item) => item.id === roomId);
  const addTenant = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeId || !name.trim() || !/^\+?[\d\s()-]{8,18}$/.test(mobile.trim()) || !roomId || !bed || !rent || !joiningDate) {
      setError("Enter valid tenant contact details, select an available room and bed, and complete rent and joining date.");
      return;
    }
    if (aadhaar.trim() && !/^\d{12}$/.test(aadhaar.replace(/[\s-]/g, ""))) { setError("Enter a valid 12-digit Aadhaar number."); return; }
    if (aadhaar.trim() && !await checkAadhaar()) { setError("Aadhaar number is already registered or could not be checked."); return; }
    if (createLogin && (password.length < 8 || password.length > 72)) { setError("Login passwords must be 8–72 characters."); return; }
    setBusy(true); setError("");
    const staged: string[] = [];
    try {
      let admissionGrantId = historyGrantId;
      if (!admissionGrantId && email.trim()) {
        const history = await api.post<{ grant_id: string | null; reports: Record<string, any>[] }>(
          `/owner/tenant-history/automatic-lookup?hostel_id=${encodeURIComponent(activeId)}`,
          { email: email.trim() },
        );
        if (history.grant_id && history.reports.length > 0) {
          setHistoryGrantId(history.grant_id); setHistoryReports(history.reports);
          throw new Error("Previous hostel reports were found. Review the consented history before adding this tenant.");
        }
        admissionGrantId = history.grant_id || "";
      }
      const refs: Record<string, string> = {};
      for (const kind of ["aadhaar_front", "aadhaar_back", "selfie"]) {
        const file = documents[kind];
        if (!file) continue;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Tenant documents must be JPG, PNG or WebP images no larger than 10 MB.");
        const response = await api.upload<{ upload_id: string }>(`/owner/tenant-documents?hostel_id=${encodeURIComponent(activeId)}&kind=${kind}`, file);
        refs[kind] = response.upload_id; staged.push(response.upload_id);
      }
      await api.post("/owner/tenants", {
        hostel_id: activeId, name: name.trim(), mobile: mobile.trim(), email: email.trim() || undefined,
        room_id: roomId, bed_number: bed, joining_date: joiningDate,
        aadhaar_number: aadhaar.trim() || undefined, documents: refs,
        monthly_rent: Number(rent), security_deposit: Number(deposit) || 0, advance_amount: Number(advance) || 0,
        create_login: createLogin, ...(createLogin ? { password } : {}),
        history_grant_id: admissionGrantId || undefined,
      });
      setShowAdd(false); setName(""); setMobile(""); setEmail(""); setRoomId(""); setBed(""); setRent(""); setAadhaar(""); setHistoryCode(""); setHistoryGrantId(""); setHistoryReports([]); setDocuments({ aadhaar_front: null, aadhaar_back: null, selfie: null });
      await load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not add tenant.";
      const cleanup = await Promise.allSettled(staged.map((id) => api.delete(`/owner/tenant-documents/${encodeURIComponent(id)}`)));
      const cleanupFailed = cleanup.some((result) => result.status === "rejected");
      setError(cleanupFailed ? `${message} Some temporary document uploads could not be cleaned up.` : message);
    } finally { setBusy(false); }
  };
  const checkAadhaar = async () => {
    if (!activeId || !/^\d{12}$/.test(aadhaar.replace(/[\s-]/g, ""))) { setAadhaarStatus("Enter a valid 12-digit Aadhaar number first."); return false; }
    try {
      const result = await api.post<{ available: boolean }>(`/owner/tenants/check-aadhaar?hostel_id=${encodeURIComponent(activeId)}`, { aadhaar_number: aadhaar });
      setAadhaarStatus(result.available ? "Aadhaar number is available." : "This Aadhaar number is already registered.");
      return result.available;
    } catch (reason) { setAadhaarStatus(reason instanceof Error ? reason.message : "Could not check Aadhaar."); return false; }
  };
  const lookupHistory = async () => {
    if (!historyCode.trim()) { setHistoryError("Enter the one-time share code provided by the tenant."); return; }
    setHistoryError(""); setHistoryGrantId(""); setHistoryReports([]);
    try {
      const result = await api.post<{ grant_id: string; reports: Record<string, any>[] }>(
        `/owner/tenant-history/lookup?hostel_id=${encodeURIComponent(activeId)}`,
        { code: historyCode.trim() },
      );
      if (!result.grant_id) throw new Error("The lookup did not return an admission grant.");
      setHistoryGrantId(result.grant_id); setHistoryReports(result.reports || []);
    } catch (reason) { setHistoryError(reason instanceof Error ? reason.message : "Could not look up shared tenant history."); }
  };
  const openTenant = async (tenant: Record<string, any>) => {
    setSelected(tenant); setDetail(null); setReports([]);
    try {
      const [tenantDetails, reportResult] = await Promise.all([
        api.get<Record<string, any>>(`/owner/tenants/${encodeURIComponent(tenant.id)}`),
        api.get<{ reports: Record<string, any>[] }>(`/owner/tenants/${encodeURIComponent(tenant.id)}/reports`),
      ]);
      setDetail(tenantDetails); setReports(reportResult.reports);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load tenant details."); }
  };
  const tenantAction = async (tenant: Record<string, any>, action: "checkout" | "archive") => {
    const message = action === "checkout"
      ? "Check out this tenant? Their room occupancy will be cleared."
      : "Archive this tenant record? This removes the tenant from the active list.";
    if (!window.confirm(message)) return;
    try {
      if (action === "checkout") await api.post(`/owner/tenants/${encodeURIComponent(tenant.id)}/checkout`);
      else await api.delete(`/owner/tenants/${encodeURIComponent(tenant.id)}`);
      setSelected(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update tenant."); }
  };
  const transfer = async () => {
    if (!selected || !transferRoom || !transferBed) { setError("Choose a destination room and available bed."); return; }
    try {
      await api.post(`/owner/tenants/${encodeURIComponent(selected.id)}/transfer`, { room_id: transferRoom, bed_number: transferBed });
      await openTenant(selected); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not transfer tenant."); }
  };
  const createReport = async () => {
    const amount = reportAmount.trim() ? Number(reportAmount) : 0;
    if (!selected || !reportDetails.trim() || !Number.isSafeInteger(amount) || amount < 0 || (reportEvidence && (
      !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(reportEvidence.type) || reportEvidence.size > 10 * 1024 * 1024
    ))) { setError("Enter report details and a valid non-negative amount. Evidence must be PDF, JPG, PNG or WebP up to 10 MB."); return; }
    try {
      const reportResult = await api.post<{ report: { id: string } }>(`/owner/tenants/${encodeURIComponent(selected.id)}/reports`, {
        category: reportCategory,
        title: ({ unpaid_rent: "Unpaid rent", pending_utilities: "Pending utility bills", property_damage: "Property damage", unpaid_agreed_charges: "Unpaid agreed charges", other: "Other legitimate issue" } as Record<string, string>)[reportCategory],
        description: reportDetails.trim(),
        amount_claimed: amount,
        evidence_summary: reportEvidenceSummary.trim() || undefined,
      });
      if (reportEvidence) await api.upload(`/owner/tenant-reports/${encodeURIComponent(reportResult.report.id)}/evidence`, reportEvidence);
      setReportAmount(""); setReportDetails("");
      setReportEvidenceSummary(""); setReportEvidence(null);
      const reportResponse = await api.get<{ reports: Record<string, any>[] }>(`/owner/tenants/${encodeURIComponent(selected.id)}/reports`);
      setReports(reportResponse.reports);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create tenant report."); }
  };
  const reportStatus = async (id: string, status: string) => {
    try {
      await api.put(`/owner/tenant-reports/${encodeURIComponent(id)}/status`, { status });
      if (selected) {
        const result = await api.get<{ reports: Record<string, any>[] }>(`/owner/tenants/${encodeURIComponent(selected.id)}/reports`);
        setReports(result.reports);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update report."); }
  };
  const settleReport = async (id: string) => {
    const amount = Number(settlementAmounts[id]);
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError("Enter a positive whole-number settlement amount."); return; }
    try {
      await api.post(`/owner/tenant-reports/${encodeURIComponent(id)}/settlements`, { amount });
      setSettlementAmounts((current) => ({ ...current, [id]: "" }));
      if (selected) {
        const result = await api.get<{ reports: Record<string, any>[] }>(`/owner/tenants/${encodeURIComponent(selected.id)}/reports`);
        setReports(result.reports);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record settlement."); }
  };
  const openDocument = async (kind: string) => {
    if (!selected) return;
    try {
      const blob = await api.getBlob(`/owner/tenants/${encodeURIComponent(selected.id)}/documents/${kind}`);
      const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open private tenant document."); }
  };

  return <Page title="Tenants" subtitle={`${tenants.length} tenants`} actions={<Button onClick={() => setShowAdd(true)}>Add Tenant</Button>}>
    <OwnerError value={error} />
    <Card className="table-scroll"><table><thead><tr><th>Name</th><th>Room / Bed</th><th>Rent</th><th>Payment</th><th>Mobile</th><th>Actions</th></tr></thead><tbody>
      {tenants.map((tenant) => <tr key={tenant.id}><td><button className="quiet-link" onClick={() => void openTenant(tenant)}>{tenant.name}</button></td><td>{tenant.room_number || "—"} / {tenant.bed_number || "—"}</td><td>₹{tenant.monthly_rent}</td><td><span className={`badge ${tenant.payment_status === "due" ? "warning" : "success"}`}>{tenant.payment_status || "—"}</span></td><td>{tenant.mobile}</td><td><div className="row"><Button kind="secondary" onClick={() => void openTenant(tenant)}>Manage</Button><Button kind="ghost" onClick={() => void tenantAction(tenant, "checkout")}>Checkout</Button></div></td></tr>)}
    </tbody></table>{!tenants.length && <p>No tenants in this hostel.</p>}</Card>

    {showAdd && <div className="modal-backdrop"><section className="modal">
      <div className="spread"><h2>Add Tenant</h2><Button kind="ghost" onClick={() => setShowAdd(false)}>Close</Button></div>
      <form className="form" onSubmit={(event) => void addTenant(event)}>
        <div className="form grid-form">
          <Field label="Full name" value={name} onChange={setName} maxLength={100} required />
          <Field label="Mobile number" value={mobile} onChange={setMobile} type="tel" required />
          <Field label="Email (optional)" value={email} onChange={setEmail} type="email" />
          <Field label="Room" value={roomId} onChange={(value) => { setRoomId(value); setBed(""); setRent(String(rooms.find((item) => item.id === value)?.rent || "")); }} options={rooms.filter((room) => freeBeds(room).length).map((room) => room.id)} optionLabels={Object.fromEntries(rooms.map((room) => [room.id, `Room ${room.room_number} · Floor ${room.floor}`]))} required />
          {selectedRoom && <Field label="Available bed" value={bed} onChange={setBed} options={freeBeds(selectedRoom).map((item: Record<string, any>) => String(item.bed_number))} required />}
          <Field label="Monthly rent (₹)" value={rent} onChange={setRent} type="number" min={0} required />
          <Field label="Security deposit (₹)" value={deposit} onChange={setDeposit} type="number" min={0} />
          <Field label="Advance amount (₹)" value={advance} onChange={setAdvance} type="number" min={0} />
          <Field label="Joining date" value={joiningDate} onChange={setJoiningDate} type="date" required />
          <Field label="Aadhaar number (optional)" value={aadhaar} onChange={setAadhaar} maxLength={14} />
        </div>
        {roomId && <p className="muted small">Selected room ID: {roomId}</p>}
        <div className="row"><Button kind="secondary" onClick={() => void checkAadhaar()}>Check Aadhaar availability</Button><span className="small muted">{aadhaarStatus}</span></div>
        <Card className="stack"><b>Optional global history check</b><p className="muted small">A tenant may provide a one-time share code. Automatic lookup only returns history when the tenant has enabled consent and verified their Google identity.</p>
          <div className="row"><Field label="One-time share code" value={historyCode} onChange={setHistoryCode} /><Button kind="secondary" onClick={() => void lookupHistory()}>Look up code</Button></div>
          {historyGrantId && <AlertMessage tone="success">Consent verified; the grant will be linked when this tenant is added.</AlertMessage>}
          {historyError && <AlertMessage tone="error">{historyError}</AlertMessage>}
          {historyReports.map((report) => <p key={report.id}>{report.previous_hostel || "Previous hostel"} · {report.category} · ₹{report.outstanding_balance ?? report.amount} · {report.status}</p>)}
        </Card>
        {(["aadhaar_front", "aadhaar_back", "selfie"] as const).map((kind) => <label className="field" key={kind}><span>{kind.replace("_", " ")} (optional)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setDocuments((current) => ({ ...current, [kind]: event.target.files?.[0] || null }))} /></label>)}
        <label className="row"><input type="checkbox" checked={createLogin} onChange={(event) => setCreateLogin(event.target.checked)} /><span>Create tenant login account</span></label>
        {createLogin && <Field label="Temporary password (8–72 characters)" value={password} onChange={setPassword} type="password" maxLength={72} required />}
        <Button type="submit" disabled={busy}>{busy ? "Saving tenant…" : "Add Tenant"}</Button>
      </form>
    </section></div>}

    {selected && <div className="modal-backdrop"><section className="modal">
      <div className="spread"><h2>{detail?.tenant?.name || selected.name}</h2><Button kind="ghost" onClick={() => setSelected(null)}>Close</Button></div>
      {!detail ? <p className="muted">Loading tenant details…</p> : <>
        <Card className="stack"><p>{detail.tenant?.mobile} · {detail.tenant?.email || "No email"}</p><p>Room {detail.room?.room_number} · Bed {detail.tenant?.bed_number} · Rent ₹{detail.tenant?.monthly_rent}</p><p>Deposit ₹{detail.tenant?.security_deposit} · Advance ₹{detail.tenant?.advance_amount}</p></Card>
        <div className="row">{(["aadhaar_front", "aadhaar_back", "selfie"] as const).map((kind) => detail.documents?.[kind] && <Button key={kind} kind="secondary" onClick={() => void openDocument(kind)}>View {kind.replace("_", " ")}</Button>)}</div>
        <Card className="stack"><h3>Transfer room / bed</h3><div className="row">
          <Field label="Room" value={transferRoom} onChange={(value) => { setTransferRoom(value); setTransferBed(""); }} options={rooms.filter((room) => freeBeds(room).length).map((room) => room.id)} optionLabels={Object.fromEntries(rooms.map((room) => [room.id, `Room ${room.room_number}`]))} />
          <Field label="Bed" value={transferBed} onChange={setTransferBed} options={freeBeds(rooms.find((room) => room.id === transferRoom) || {}).map((item: Record<string, any>) => String(item.bed_number))} />
          <Button onClick={() => void transfer()}>Transfer</Button></div></Card>
        <Card className="stack"><h3>Global history reports</h3>{reports.map((report) => <article key={report.id} className="card">
          <b>{report.category} · ₹{report.outstanding_balance ?? report.amount_claimed ?? report.amount}</b><p>{report.details}</p><p>Status: {report.status}</p>
          {report.tenant_response?.text && <p>Tenant response: {report.tenant_response.text}</p>}
          {report.evidence_documents?.map((evidence: Record<string, any>) => <Button key={evidence.id} kind="secondary" onClick={async () => {
            try { const blob = await api.getBlob(`/owner/tenant-reports/${encodeURIComponent(report.id)}/evidence/${encodeURIComponent(evidence.id)}`); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
            catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open report evidence."); }
          }}>View evidence: {evidence.filename}</Button>)}
          <div className="row"><Button kind="secondary" onClick={() => void reportStatus(report.id, "resolved")}>Resolve</Button><Button kind="secondary" onClick={() => void reportStatus(report.id, "disputed")}>Mark disputed</Button>
            <Field label="Settlement amount" value={settlementAmounts[report.id] || ""} onChange={(value) => setSettlementAmounts((current) => ({ ...current, [report.id]: value }))} type="number" min={1} /><Button onClick={() => void settleReport(report.id)}>Record settlement</Button></div>
        </article>)}
          <Field label="Report category" value={reportCategory} onChange={setReportCategory} options={["unpaid_rent", "pending_utilities", "property_damage", "unpaid_agreed_charges", "other"]} />
          <Field label="Amount claimed (₹)" value={reportAmount} onChange={setReportAmount} type="number" min={1} />
          <Field label="Report details" value={reportDetails} onChange={setReportDetails} multiline />
          <Field label="Evidence summary (optional)" value={reportEvidenceSummary} onChange={setReportEvidenceSummary} maxLength={1000} />
          <label className="field"><span>Supporting evidence (optional; PDF, JPG, PNG, WebP up to 10 MB)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setReportEvidence(event.target.files?.[0] || null)} /></label>
          <Button onClick={() => void createReport()}>Submit report</Button>
        </Card>
        <div className="row"><Button kind="secondary" onClick={() => void tenantAction(selected, "checkout")}>Check out</Button><Button kind="danger" onClick={() => void tenantAction(selected, "archive")}>Archive tenant</Button></div>
      </>}
    </section></div>}
  </Page>;
}

export function OwnerMoneyPage() {
  const { activeId } = useOwnerHostel();
  const [tab, setTab] = useState<"rent" | "approvals" | "expenses">("rent");
  const [payments, setPayments] = useState<Record<string, any>[]>([]);
  const [pending, setPending] = useState<Record<string, any>[]>([]);
  const [tenants, setTenants] = useState<Record<string, any>[]>([]);
  const [expenses, setExpenses] = useState<Record<string, any>[]>([]);
  const [categories, setCategories] = useState<Record<string, any>[]>([]);
  const [error, setError] = useState("");
  const [showRent, setShowRent] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [rentType, setRentType] = useState("rent");
  const [method, setMethod] = useState("cash");
  const [showExpense, setShowExpense] = useState(false);
  const [category, setCategory] = useState("electricity");
  const [purpose, setPurpose] = useState("property");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [note, setNote] = useState("");
  const [foodProducts, setFoodProducts] = useState<FoodProduct[]>([{ product_name: "", quantity: "", amount: "" }]);
  const [rejectId, setRejectId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryPurpose, setCategoryPurpose] = useState("property");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) return;
    try {
      const hostelId = encodeURIComponent(activeId);
      const [rentResult, expenseResult, categoryResult] = await Promise.all([
        api.get<{ payments: Record<string, any>[]; pending_payments?: Record<string, any>[]; tenants: Record<string, any>[] }>(`/owner/rent?hostel_id=${hostelId}`),
        api.get<{ expenses: Record<string, any>[] }>(`/owner/expenses?hostel_id=${hostelId}`),
        api.get<{ categories: Record<string, any>[] }>(`/owner/expense-categories?hostel_id=${hostelId}`),
      ]);
      setPayments(rentResult.payments.filter((item) => !["pending_owner_approval", "approval_processing"].includes(item.status)));
      setPending(rentResult.pending_payments || rentResult.payments.filter((item) => ["pending_owner_approval", "approval_processing"].includes(item.status)));
      setTenants(rentResult.tenants); setExpenses(expenseResult.expenses); setCategories(categoryResult.categories); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load rent and expense records."); }
  }, [activeId]);
  useEffect(() => { void load(); }, [load]);
  const collect = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(rentAmount);
    if (!tenantId || !Number.isSafeInteger(amount) || amount <= 0) { setError("Choose a tenant and enter a positive whole-number amount."); return; }
    setBusy(true);
    try { await api.post("/owner/rent", { tenant_id: tenantId, amount, type: rentType, method }); setShowRent(false); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not record rent."); }
    finally { setBusy(false); }
  };
  const recordExpense = async (event: FormEvent) => {
    event.preventDefault();
    let foodItems: { product_name: string; quantity: string; amount: number }[] | undefined;
    if (category === "food") {
      if (foodProducts.some((item) => !item.product_name.trim() || !item.quantity.trim() || !/^\d+$/.test(item.amount.trim()) || !Number.isSafeInteger(Number(item.amount)) || Number(item.amount) <= 0)) {
        setError("For every food item, enter product name, quantity, and its manually entered positive whole-number amount.");
        return;
      }
      foodItems = foodProducts.map((item) => ({ product_name: item.product_name.trim(), quantity: item.quantity.trim(), amount: Number(item.amount) }));
    } else if (!Number.isSafeInteger(Number(expenseAmount)) || Number(expenseAmount) <= 0) { setError("Enter a positive whole-number expense amount."); return; }
    setBusy(true); setError("");
    try {
      await api.post("/owner/expenses", {
        hostel_id: activeId, category, purpose,
        ...(foodItems ? { food_items: foodItems } : { amount: Number(expenseAmount) }),
        note, date: new Date().toISOString(),
      });
      setShowExpense(false); setExpenseAmount(""); setNote(""); setFoodProducts([{ product_name: "", quantity: "", amount: "" }]); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save expense."); }
    finally { setBusy(false); }
  };
  const approve = async (payment: Record<string, any>) => {
    if (!window.confirm("Verify this UPI transaction against your bank records before approving. Rent balance will be updated and a receipt issued.")) return;
    try { await api.post(`/owner/rent/${encodeURIComponent(payment.id)}/approve`, {}); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not approve payment."); }
  };
  const reject = async (event: FormEvent) => {
    event.preventDefault();
    if (!rejectId || !rejectReason.trim()) { setError("Enter a rejection reason."); return; }
    try { await api.post(`/owner/rent/${encodeURIComponent(rejectId)}/reject`, { reason: rejectReason.trim() }); setRejectId(""); setRejectReason(""); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reject payment."); }
  };
  const addCategory = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeId || !categoryName.trim()) { setError("Enter a category name."); return; }
    try {
      await api.post("/owner/expense-categories", {
        hostel_id: activeId, name: categoryName.trim(), description: categoryDescription.trim() || null, purpose: categoryPurpose,
      });
      setCategoryName(""); setCategoryDescription("");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add expense category."); }
  };
  const collectTotal = payments.filter((item) => item.status === "paid").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const propertyExpenses = expenses.filter((item) => item.purpose === "property").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return <Page title="Rent & Expenses" actions={<Button onClick={() => setShowExpense(true)}>Add Expense</Button>}>
    <OwnerError value={error} />
    <div className="row">{(["rent", "approvals", "expenses"] as const).map((item) => <Button key={item} kind={tab === item ? "primary" : "secondary"} onClick={() => setTab(item)}>{item === "approvals" ? `Approvals (${pending.length})` : item}</Button>)}</div>
    {tab === "rent" && <div className="stack">
      <Card className="spread"><div><span className="muted">Total collected</span><div className="stat">₹{collectTotal.toLocaleString("en-IN")}</div></div><Button onClick={() => setShowRent(true)}>Record Rent</Button></Card>
      <Card className="stack"><h2>Pending dues</h2>{tenants.filter((item) => item.payment_status === "due").map((tenant) => <div className="spread" key={tenant.id}><span>{tenant.name} · Room {tenant.room_number} · ₹{tenant.monthly_rent}</span><Button kind="secondary" onClick={() => { setTenantId(tenant.id); setRentAmount(String(tenant.monthly_rent)); setShowRent(true); }}>Collect</Button></div>)}{!tenants.some((item) => item.payment_status === "due") && <p>No pending dues.</p>}</Card>
      <Card className="stack"><h2>Payment history</h2>{payments.map((payment) => <div className="spread" key={payment.id}><div><b>{payment.tenant_name}</b><p className="muted small">{payment.receipt_no ? `Receipt ${payment.receipt_no}` : `UPI ref ${payment.upi_reference || "—"}`} · {payment.method} · {payment.date ? new Date(payment.date).toLocaleDateString() : ""}</p>{payment.rejection_reason && <p className="badge error">{payment.rejection_reason}</p>}</div><b>₹{payment.amount}</b></div>)}{!payments.length && <p>No payments yet.</p>}</Card>
    </div>}
    {tab === "approvals" && <Card className="stack"><h2>Verify UPI transfers against bank records</h2>{pending.map((payment) => <article className="card stack" key={payment.id}>
      <div className="spread"><b>{payment.tenant_name}</b><b>₹{payment.amount}</b></div><p>{payment.date ? new Date(payment.date).toLocaleDateString() : ""} · {payment.method?.replaceAll("_", " ")} · Room {payment.room_number}</p><p>UPI reference: {payment.upi_reference}</p>
      <AlertMessage tone="info">This is a tenant-reported payment and has not been verified.</AlertMessage>
      {payment.evidence_id && <Button kind="secondary" onClick={async () => {
        try { const blob = await api.getBlob(`/owner/rent/${encodeURIComponent(payment.id)}/evidence`); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open screenshot."); }
      }}>View payment screenshot</Button>}
      <div className="row"><Button onClick={() => void approve(payment)}>Approve</Button><Button kind="danger" onClick={() => setRejectId(payment.id)}>Reject</Button></div>
      {rejectId === payment.id && <form className="form" onSubmit={(event) => void reject(event)}><Field label="Rejection reason" value={rejectReason} onChange={setRejectReason} multiline required /><Button type="submit">Confirm rejection</Button></form>}
    </article>)}{!pending.length && <p>No payments awaiting approval.</p>}</Card>}
    {tab === "expenses" && <Card className="stack"><div className="spread"><h2>Expenses</h2><b>Property expenses ₹{propertyExpenses.toLocaleString("en-IN")}</b></div>
      {expenses.map((item) => <div className="spread" key={item.id}><div><b>{item.category}</b><p className="muted small">{item.purpose || "Legacy / unclassified"} · {item.note || ""}</p>
        {item.food_items?.map((food: Record<string, any>, index: number) => <p className="small" key={index}>{food.product_name} — {food.quantity} — ₹{food.amount}</p>)}</div><b>₹{item.amount}</b></div>)}
      {!expenses.length && <p>No expenses recorded.</p>}
      {categories.length > 0 && <p className="muted small">Custom categories: {categories.map((item) => item.name).join(", ")}</p>}
      <details><summary>Add custom expense category</summary><form className="form" onSubmit={(event) => void addCategory(event)}>
        <Field label="Category name" value={categoryName} onChange={setCategoryName} required /><Field label="Description (optional)" value={categoryDescription} onChange={setCategoryDescription} />
        <Field label="Purpose" value={categoryPurpose} onChange={setCategoryPurpose} options={["property", "personal"]} /><Button type="submit">Add category</Button>
      </form></details>
    </Card>}
    {showRent && <div className="modal-backdrop"><section className="modal"><div className="spread"><h2>Record rent payment</h2><Button kind="ghost" onClick={() => setShowRent(false)}>Close</Button></div>
      <form className="form" onSubmit={(event) => void collect(event)}><Field label="Tenant" value={tenantId} onChange={(id) => { setTenantId(id); setRentAmount(String(tenants.find((item) => item.id === id)?.monthly_rent || "")); }} options={tenants.map((item) => item.id)} optionLabels={Object.fromEntries(tenants.map((item) => [item.id, `${item.name} · Room ${item.room_number}`]))} required />
        <Field label="Amount (₹)" value={rentAmount} onChange={setRentAmount} type="number" min={1} required /><Field label="Payment type" value={rentType} onChange={setRentType} options={["rent", "deposit", "advance", "other"]} />
        <Field label="Payment method" value={method} onChange={setMethod} options={["cash", "upi", "bank_transfer", "other"]} /><Button type="submit" disabled={busy}>Record payment</Button></form></section></div>}
    {showExpense && <div className="modal-backdrop"><section className="modal"><div className="spread"><h2>Add expense</h2><Button kind="ghost" onClick={() => setShowExpense(false)}>Close</Button></div>
      <form className="form" onSubmit={(event) => void recordExpense(event)}>
        <div className="form grid-form"><Field label="Category" value={category} onChange={setCategory} options={[...DEFAULT_EXPENSES, ...categories.map((item) => item.name)]} />
          <Field label="Expense type" value={purpose} onChange={setPurpose} options={["property", "personal"]} /></div>
        {category === "food" ? <div className="stack"><p className="muted">Manually enter each food product's amount. Quantity is for description only; no automatic multiplication or amount generation is performed.</p>
          {foodProducts.map((item, index) => <div className="food-row" key={index}>
            <Field label="Product Name" value={item.product_name} onChange={(value) => setFoodProducts((current) => current.map((product, i) => i === index ? { ...product, product_name: value } : product))} required />
            <Field label="Quantity" value={item.quantity} onChange={(value) => setFoodProducts((current) => current.map((product, i) => i === index ? { ...product, quantity: value } : product))} required />
            <Field label="Price / Amount (₹)" value={item.amount} onChange={(value) => setFoodProducts((current) => current.map((product, i) => i === index ? { ...product, amount: value } : product))} type="number" min={1} required />
            {foodProducts.length > 1 && <Button kind="danger" onClick={() => setFoodProducts((current) => current.filter((_, i) => i !== index))}>Remove</Button>}
          </div>)}
          <Button kind="secondary" onClick={() => setFoodProducts((current) => [...current, { product_name: "", quantity: "", amount: "" }])}>Add food product</Button>
        </div> : <Field label="Amount (₹)" value={expenseAmount} onChange={setExpenseAmount} type="number" min={1} required />}
        <Field label="Note (optional)" value={note} onChange={setNote} multiline /><Button type="submit" disabled={busy}>Save expense</Button>
      </form></section></div>}
  </Page>;
}
