import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
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
  const addPhotos = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    const remaining = Math.max(0, 8 - values.photos.length);
    if (!remaining || !files.length) return;
    const validFiles = files.slice(0, remaining).filter((file) => {
      if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) return true;
      setError("Choose JPG, PNG, or WebP images.");
      return false;
    });
    const loaded = await Promise.all(validFiles.map((file) => new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    })));
    if (loaded.some((photo) => photo === null)) setError("Could not read one or more selected photos.");
    setValues((current) => ({ ...current, photos: [...current.photos, ...loaded.filter((photo): photo is string => photo !== null)].slice(0, 8) }));
  };
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
    <label className="field"><span>Hostel photos ({values.photos.length}/8)</span><input aria-label="Select hostel photos" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={values.photos.length >= 8} onChange={(event) => void addPhotos(event)} /></label>
    <div className="tag-row">{values.photos.map((photo, index) => <div key={`${index}-${photo.slice(0, 24)}`} style={{ position: "relative", display: "inline-flex" }}>
      <img src={photo} alt={`Hostel photo ${index + 1}`} width="76" height="76" style={{ objectFit: "cover", borderRadius: 8 }} />
      <button type="button" aria-label={`Remove hostel photo ${index + 1}`} onClick={() => update("photos", values.photos.filter((_, photoIndex) => photoIndex !== index))}
        style={{ position: "absolute", top: 3, right: 3, width: 24, height: 24, padding: 0, border: 0, borderRadius: "50%", color: "#fff", background: "var(--danger)", lineHeight: 1 }}>×</button>
    </div>)}</div>
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
  const { activeId, activeHostel, hostels, error: hostelError, loading: hostelsLoading, refresh, setActiveId } = useOwnerHostel();
  const dashboard = useHostelData<Record<string, any>>("/owner/dashboard", {});
  const reports = useHostelData<{ monthly?: { month: string; collection: number; expense: number; profit: number }[] }>("/owner/reports", {});
  const [portfolio, setPortfolio] = useState<Record<string, any> | null>(null);
  const [portfolioError, setPortfolioError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showAllProperties, setShowAllProperties] = useState(false);
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
  }}>Edit Hostel</Button></>} className="owner-dashboard-page">
    <OwnerError value={dashboard.error || reports.error || portfolioError} />
    <AdvertisementSlot />
    {dashboard.loading ? <p className="muted">Loading dashboard…</p> : <div className="stack">
      <div className="owner-summary-grid">
        {dashboard.data.hostel_status && <Card className="owner-summary-card owner-summary-card--pink">
          <OwnerDashboardIcon name="listing" />
          <div className="owner-summary-content"><span className="owner-summary-label">Listing Status</span><span className={`badge ${dashboard.data.hostel_status === "approved" ? "success" : "warning"}`}>{dashboard.data.hostel_status === "approved" ? "Live" : dashboard.data.hostel_status}</span></div>
        </Card>}
        {dashboard.data.subscription && <Card className="owner-summary-card owner-summary-card--blue">
          <OwnerDashboardIcon name="subscription" />
          <div className="owner-summary-content"><span className="owner-summary-label">Subscription</span><strong className="owner-summary-value">{dashboard.data.subscription.status}</strong><span className="owner-summary-detail">{dashboard.data.subscription.days_left} days left</span></div>
          <Link className="owner-summary-manage" to="/owner/more">Manage</Link>
        </Card>}
        {[
          ["Monthly Collection", dashboard.data.monthly_collection, "green", "collection", true],
          ["Expenses", dashboard.data.monthly_expenses, "orange", "expenses", true],
          ["Net Profit", dashboard.data.monthly_profit, "purple", "profit", true],
          ["Occupancy", `${dashboard.data.occupancy_pct ?? 0}%`, "sky", "occupancy"],
          ["Rooms", dashboard.data.total_rooms, "lavender", "rooms"],
          ["Tenants", dashboard.data.total_tenants, "pink", "tenants"],
          ["Vacant Beds", dashboard.data.available_beds, "teal", "vacant"],
          ["Pending Payments", dashboard.data.pending_payments, "amber", "payments"],
        ].map(([label, value, tone, icon, isMoney]) => <Card key={String(label)} className={`owner-summary-card owner-summary-card--${tone}`}>
          <OwnerDashboardIcon name={String(icon)} />
          <div className="owner-summary-content"><span className="owner-summary-label">{label}</span><strong className="owner-summary-value">{value === undefined ? "—" : isMoney ? `₹${value}` : value}</strong></div>
        </Card>)}
      </div>
      <div className="owner-overview-grid">
        <Card className="owner-properties-card">
          <div className="owner-panel-heading">
            <div className="owner-panel-title"><span className="owner-panel-icon"><OwnerDashboardIcon name="property" /></span><div><h2>All Properties</h2><p>{portfolio ? `${portfolio.total_hostels} hostels · ${portfolio.total_tenants} tenants · ${portfolio.total_beds} beds` : "Your hostel portfolio"}</p></div></div>
            {(portfolio?.per_hostel?.length || 0) > 3 && <button className="owner-view-all" type="button" onClick={() => setShowAllProperties((current) => !current)}>{showAllProperties ? "Show Less" : "View All Properties"} <span aria-hidden="true">{showAllProperties ? "↑" : "→"}</span></button>}
          </div>
          {portfolio?.per_hostel?.length ? <div className="owner-property-list">
            {(showAllProperties ? portfolio.per_hostel : portfolio.per_hostel.slice(0, 3)).map((property: Record<string, any>) => {
              const hostel = hostels.find((item) => item.id === property.id);
              const selected = property.id === activeId;
              return <button className={`owner-property-row${selected ? " is-selected" : ""}`} type="button" key={property.id} onClick={() => setActiveId(property.id)} aria-current={selected ? "true" : undefined}>
                <span className="owner-property-mark"><OwnerDashboardIcon name="property" /></span>
                <span className="owner-property-main"><strong>{property.name}</strong><span>{[hostel?.area, hostel?.city].filter(Boolean).join(", ") || "Hostel property"}</span></span>
                <span className={`badge ${property.status === "approved" ? "success" : property.status ? "warning" : ""}`}>{property.status === "approved" ? "Live" : property.status || "—"}</span>
                <span className="owner-property-stats"><span><b>{property.beds}</b> beds</span><span><b>{property.tenants}</b> tenants</span><span><b>{property.occupancy_pct}%</b> occupied</span></span>
              </button>;
            })}
          </div> : <div className="owner-property-empty"><span className="owner-property-mark"><OwnerDashboardIcon name="property" /></span><div><strong>{activeHostel?.name || "Your hostel"}</strong><span>{[activeHostel?.area, activeHostel?.city].filter(Boolean).join(", ") || activeHostel?.address || "Property details"}</span></div><span className="badge">{dashboard.data.hostel_status || "—"}</span></div>}
          {portfolio && <div className="owner-portfolio-totals">
            <div><span>Total collection</span><strong>₹{portfolio.total_collection ?? "—"}</strong></div>
            <div><span>Expenses</span><strong>₹{portfolio.total_expenses ?? "—"}</strong></div>
            <div><span>Net profit</span><strong>₹{portfolio.net_profit ?? "—"}</strong></div>
            <div><span>Occupancy</span><strong>{portfolio.occupancy_pct ?? "—"}%</strong></div>
            {portfolio.personal_expenses != null && <div><span>Personal expenses</span><strong>₹{portfolio.personal_expenses}</strong></div>}
            {portfolio.unclassified_expenses != null && <div><span>Unclassified expenses</span><strong>₹{portfolio.unclassified_expenses}</strong></div>}
          </div>}
        </Card>
        <OwnerCollectionChart monthly={reports.data.monthly || []} loading={reports.loading} />
      </div>
      <Card className="owner-quick-actions">
        <div className="owner-section-heading"><span className="owner-section-icon"><OwnerDashboardIcon name="actions" /></span><h2>Quick Actions</h2></div>
        <div className="owner-action-grid">{[
          ["Rooms & Beds", "/owner/rooms", "rooms", "Add, edit and manage rooms and beds"],
          ["Tenants", "/owner/tenants", "tenants", "View and manage tenants"],
          ["Rent & Expenses", "/owner/money", "collection", "Record rent, expenses and reports"],
          ["Tenant registration", "/owner/tenant-registration", "registration", "Register and allocate tenants"],
          ["Rules", "/owner/rules", "rules", "Manage hostel rules and regulations"],
          ["More", "/owner/more", "more", "Additional tools and settings"],
        ].map(([label, path, icon, description]) => <Link className="owner-action-link" key={path} to={path}>
          <span className={`owner-action-icon owner-action-icon--${icon}`}><OwnerDashboardIcon name={String(icon)} /></span>
          <span className="owner-action-copy"><strong>{label}</strong><small>{description}</small></span>
          <span className="owner-action-arrow" aria-hidden="true">→</span>
        </Link>)}</div>
      </Card>
    </div>}
    {showForm && <div className="modal-backdrop"><section className="modal"><PropertyForm initial={editHostel} onDone={() => { setShowForm(false); setEditHostel(undefined); void refresh(); void dashboard.load(); }} /></section></div>}
  </Page>;
}

function OwnerCollectionChart({ monthly, loading }: {
  monthly: { month: string; collection: number; expense: number; profit: number }[];
  loading: boolean;
}) {
  const values = monthly.map((item) => Number(item.collection)).filter(Number.isFinite);
  const maximum = Math.max(...values, 0);
  const points = monthly.map((item, index) => {
    const x = monthly.length < 2 ? 300 : 34 + (index * 532) / (monthly.length - 1);
    const value = Number(item.collection);
    const y = maximum > 0 && Number.isFinite(value) ? 164 - (Math.max(0, value) / maximum) * 126 : 164;
    return { x, y, item, value };
  });
  const line = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const area = points.length ? `34,164 ${line} ${points[points.length - 1].x},164` : "";
  const latest = [...monthly].reverse().find((item) => Number.isFinite(Number(item.collection)));

  return <Card className="owner-collection-card">
    <div className="owner-panel-heading">
      <div className="owner-panel-title"><span className="owner-panel-icon owner-panel-icon--chart"><OwnerDashboardIcon name="collection" /></span><div><h2>Monthly Collection</h2><p>Last 6 months</p></div></div>
    </div>
    <strong className="owner-chart-total">{latest ? `₹${latest.collection}` : "—"}</strong>
    {loading ? <p className="muted small">Loading collection history…</p> : monthly.length ? <>
      <div className="owner-chart-wrap">
        <svg className="owner-collection-chart" viewBox="0 0 600 205" role="img" aria-label="Monthly collection for the last six months">
          {[38, 80, 122, 164].map((y) => <line key={y} x1="34" y1={y} x2="566" y2={y} className="owner-chart-gridline" />)}
          <polygon points={area} className="owner-chart-area" />
          <polyline points={line} className="owner-chart-line" />
          {points.map(({ x, y, item }) => <circle key={item.month} cx={x} cy={y} r="4" className="owner-chart-dot"><title>{`${item.month}: ₹${item.collection}`}</title></circle>)}
        </svg>
        <div className="owner-chart-months">{monthly.map((item) => <span key={item.month}>{formatMonthLabel(item.month)}</span>)}</div>
      </div>
      <div className="owner-chart-legend"><span><i />Collection</span><span>Monthly values from recorded payments</span></div>
    </> : <p className="owner-chart-empty">No collection history is available yet.</p>}
  </Card>;
}

function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(date.getTime()) ? month : date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function OwnerDashboardIcon({ name }: { name: string }) {
  const icons: Record<string, ReactNode> = {
    property: <><path d="M3 20.5h18M5 20.5V8l7-4 7 4v12.5M9 20.5v-5h6v5M8 10h.01M16 10h.01M8 13h.01M16 13h.01" /></>,
    listing: <><path d="M5 12.5 9.5 17 19 7.5" /><path d="M12 3.5 14.2 5l2.7-.1.9 2.5 2.2 1.6-.9 2.5.5 2.7-2.3 1.4-1.2 2.5-2.7-.4L11 19l-2.2-1.5-2.7.1-.9-2.5L3 13.5l.9-2.5-.5-2.7 2.3-1.4L7 4.4l2.7.4z" /></>,
    subscription: <><path d="M4 7.5h16v12H4z" /><path d="M4 11h16M8 4.5v3M16 4.5v3M8 15h3" /></>,
    collection: <><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" /><path d="M2.5 19.5h19" /></>,
    expenses: <><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 12h5M8 15h3" /><path d="m16 14 2 2" /></>,
    profit: <><path d="M4 18 9 13l3 3 8-9" /><path d="M14 7h6v6" /></>,
    occupancy: <><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z" /><path d="M15 3.8v5.7h5.7A8.5 8.5 0 0 0 15 3.8Z" /></>,
    rooms: <><path d="M4 20V4h16v16M4 9h16M9 4v5m6-5v5M9 13h2v2H9zm5 0h2v2h-2zM9 17h2v3H9zm5 0h2v3h-2z" /></>,
    tenants: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20zM16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4V20h-3" /></>,
    vacant: <><path d="M4 20V5l8-2 8 2v15M4 11h16M9 11v9m6-9v9" /><path d="m9 7 2 2 4-4" /></>,
    payments: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.6-.8-1.6-1.2-3-1.2-1.6 0-2.7.8-2.7 2s1 1.8 2.8 2.2 2.8 1 2.8 2.2-1.1 2.1-2.9 2.1c-1.4 0-2.6-.5-3.3-1.5M12.5 5.8v12.4" /></>,
    actions: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    registration: <><path d="M7 3.5h8l4 4V20H7zM15 3.5V8h4M10 12h6m-6 3h6" /><path d="M4 7v14h12" /></>,
    rules: <><path d="M6 4h13v16H6zM9 8h7m-7 4h7m-7 4h4" /><path d="M4 7v13" /></>,
  };
  return <svg className="owner-dashboard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name] || icons.more}</svg>;
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

type TenantCreatePayload = {
  hostel_id: string;
  name: string;
  mobile: string;
  email?: string;
  room_id: string;
  bed_number: string;
  joining_date: string;
  aadhaar_number?: string;
  documents: Record<string, string>;
  monthly_rent: number;
  security_deposit: number;
  advance_amount: number;
  create_login: boolean;
  password?: string;
  history_grant_id?: string;
};

type TenantCreateResponse = {
  tenant: Record<string, any>;
  login_password?: string | null;
};

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
    if (!activeId || !name.trim() || !/^\+?[\d\s()-]+$/.test(mobile.trim()) || mobile.replace(/\D/g, "").length !== 10 || !roomId || !bed || !rent || !joiningDate) {
      setError("Enter valid tenant contact details, select an available room and bed, and complete rent and joining date.");
      return;
    }
    if (aadhaar.trim() && !/^\d{12}$/.test(aadhaar.replace(/[\s-]/g, ""))) { setError("Enter a valid 12-digit Aadhaar number."); return; }
    if (aadhaar.trim() && !await checkAadhaar()) { setError("Aadhaar number is already registered or could not be checked."); return; }
    if (createLogin && !email.trim()) { setError("Enter an email address to create a tenant login."); return; }
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
      const payload: TenantCreatePayload = {
        hostel_id: activeId, name: name.trim(), mobile: mobile.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        room_id: roomId, bed_number: bed, joining_date: joiningDate,
        aadhaar_number: aadhaar.trim() || undefined, documents: refs,
        monthly_rent: Number(rent), security_deposit: Number(deposit) || 0, advance_amount: Number(advance) || 0,
        create_login: createLogin, ...(createLogin ? { password } : {}),
        history_grant_id: admissionGrantId || undefined,
      };
      const result = await api.post<TenantCreateResponse>("/owner/tenants", payload);
      setTenants((current) => [result.tenant, ...current.filter((tenant) => tenant.id !== result.tenant.id)]);
      setShowAdd(false);
      setName(""); setMobile(""); setEmail(""); setRoomId(""); setBed(""); setRent("");
      setDeposit("0"); setAdvance("0"); setJoiningDate(new Date().toISOString().slice(0, 10));
      setAadhaar(""); setAadhaarStatus(""); setHistoryCode(""); setHistoryGrantId(""); setHistoryReports([]);
      setCreateLogin(false); setPassword("");
      setDocuments({ aadhaar_front: null, aadhaar_back: null, selfie: null });
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
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not check Aadhaar.";
      setAadhaarStatus(reason instanceof ApiError && reason.status === 405
        ? "The connected backend does not currently support Aadhaar availability checks. Update its deployment to the version that provides this endpoint."
        : message);
      return false;
    }
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
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedPaymentId = searchParams.get("payment_id");
  const [tab, setTab] = useState<"rent" | "approvals" | "expenses">(() => requestedTab === "approvals" ? "approvals" : "rent");
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
  useEffect(() => {
    if (requestedTab === "approvals") setTab("approvals");
  }, [requestedTab]);
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
  const visiblePending = requestedPaymentId
    ? [...pending].sort((a, b) => Number(b.id === requestedPaymentId) - Number(a.id === requestedPaymentId))
    : pending;
  return <Page title="Rent & Expenses" actions={<Button onClick={() => setShowExpense(true)}>Add Expense</Button>}>
    <OwnerError value={error} />
    <div className="row">{(["rent", "approvals", "expenses"] as const).map((item) => <Button key={item} kind={tab === item ? "primary" : "secondary"} onClick={() => setTab(item)}>{item === "approvals" ? `Approvals (${pending.length})` : item}</Button>)}</div>
    {tab === "rent" && <div className="stack">
      <Card className="spread"><div><span className="muted">Total collected</span><div className="stat">₹{collectTotal.toLocaleString("en-IN")}</div></div><Button onClick={() => setShowRent(true)}>Record Rent</Button></Card>
      <Card className="stack"><h2>Pending dues</h2>{tenants.filter((item) => item.payment_status === "due").map((tenant) => <div className="spread" key={tenant.id}><span>{tenant.name} · Room {tenant.room_number} · ₹{tenant.monthly_rent}</span><Button kind="secondary" onClick={() => { setTenantId(tenant.id); setRentAmount(String(tenant.monthly_rent)); setShowRent(true); }}>Collect</Button></div>)}{!tenants.some((item) => item.payment_status === "due") && <p>No pending dues.</p>}</Card>
      <Card className="stack"><h2>Payment history</h2>{payments.map((payment) => <div className="spread" key={payment.id}><div><b>{payment.tenant_name}</b><p className="muted small">{payment.receipt_no ? `Receipt ${payment.receipt_no}` : `UPI ref ${payment.upi_reference || "—"}`} · {payment.method} · {payment.date ? new Date(payment.date).toLocaleDateString() : ""}</p>{payment.rejection_reason && <p className="badge error">{payment.rejection_reason}</p>}</div><b>₹{payment.amount}</b></div>)}{!payments.length && <p>No payments yet.</p>}</Card>
    </div>}
    {tab === "approvals" && <Card className="stack"><h2>Verify UPI transfers against bank records</h2>{visiblePending.map((payment) => <article className="card stack" key={payment.id}>
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
