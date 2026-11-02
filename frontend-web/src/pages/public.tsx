import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../state";
import { AccountPage } from "./auth";
import { AlertMessage, Brand, Button, Card, Field, Page } from "../ui";

type Hostel = {
  id: string;
  name: string;
  pg_name?: string;
  city?: string;
  mobile?: string;
  area?: string;
  address?: string;
  gender?: string;
  property_type?: string;
  rating?: number;
  available_beds?: number;
  photos?: string[];
  amenities?: string[];
  room_options?: { bed_count: number; rent: number }[];
  reviews?: { id: string; name?: string; rating: number; comment?: string }[];
  verification_status?: string;
};

const landingFeatures = [
  { icon: "↗", title: "Track Expenses", description: "Monitor hostel expenses with ease.", to: "/owner/money", tone: "blue" },
  { icon: "♟", title: "Manage Students", description: "Keep student records organized.", to: "/owner/tenants", tone: "green" },
  { icon: "♨", title: "Food & Bills", description: "Manage food and utility bills simply.", to: "/owner/money", tone: "violet" },
  { icon: "✓", title: "Secure & Reliable", description: "Your data is always safe and secure.", to: "/login", tone: "amber" },
  { icon: "ϟ", title: "Fast Filing", description: "Keep hostel records and reports in one place.", to: "/owner/more", tone: "pink" },
];

export function LandingPage() {
  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>(".landing-reveal");
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <main className="landing">
      <div className="landing-orb landing-orb-one" aria-hidden="true" />
      <div className="landing-orb landing-orb-two" aria-hidden="true" />
      <header className="landing-nav">
        <Brand />
        <nav className="landing-links" aria-label="Main navigation">
          <a className="landing-nav-active" href="#home">⌂ <span>Home</span></a>
          <a href="#features">▦ <span>Features</span></a>
          <a href="#about">ⓘ <span>About</span></a>
          <a href="#contact">✉ <span>Contact</span></a>
        </nav>
        <Link className="google-nav-button" to="/login"><span className="google-g">G</span>Google Sign In</Link>
      </header>

      <section className="landing-hero" id="home">
        <div className="hero-copy">
          <span className="hero-eyebrow"><i /> Smart Hostel Management</span>
          <h1>Manage Your Hostel Smarter with <span>GoLiveHostel360</span></h1>
          <p>Track expenses, manage students, and simplify hostel operations — all in one place.</p>
          <div className="hero-actions">
            <Link className="landing-cta landing-cta-primary" to="/register">✦ <span>Get Started</span><b>→</b></Link>
            <Link className="landing-cta landing-cta-secondary" to="/explore">▶ <span>Watch Demo</span></Link>
          </div>
          <p className="hero-handwritten">Your Hostel<br />Our Care</p>
        </div>
        <div className="hero-art" aria-label="Illustration of the GoLiveHostel360 mobile experience">
          <div className="hero-skyline" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="hero-phone">
            <div className="phone-speaker" />
            <div className="phone-screen">
              <span className="phone-logo-mark">⌂</span>
              <b>GoLiveHostel360</b>
              <div className="phone-welcome">Welcome Back!<small>Manage your hostel easily</small></div>
              <span className="phone-login">Sign In</span>
              <span className="phone-register">Register</span>
              <div className="phone-building"><i /><i /><i /><i /><b>⌂</b></div>
            </div>
          </div>
          <span className="floating-pill pill-expenses"><b>▥</b> Track<br />Expenses</span>
          <span className="floating-pill pill-students"><b>♟</b> Manage<br />Students</span>
          <span className="floating-pill pill-filing"><b>ϟ</b> Fast Filing</span>
          <span className="orbit-line" aria-hidden="true" />
        </div>
        <div className="landing-wave landing-wave-back" aria-hidden="true" />
        <div className="landing-wave landing-wave-front" aria-hidden="true" />
      </section>

      <section className="landing-features" id="features" aria-label="Hostel management features">
        {landingFeatures.map((feature, index) => (
          <Link className={`feature-tile landing-reveal feature-${feature.tone}`} to={feature.to} key={feature.title} style={{ transitionDelay: `${index * 70}ms` }}>
            <span className="feature-icon">{feature.icon}</span>
            <span className="feature-copy"><b>{feature.title}</b><small>{feature.description}</small></span>
            <span className="feature-arrow">→</span>
          </Link>
        ))}
      </section>

      <section className="landing-promos">
        <article className="promo-card promo-property landing-reveal">
          <div className="promo-illustration property-illustration" aria-hidden="true"><span className="property-pin">●</span><div className="mini-building"><i /><i /><i /><i /><i /><i /><b>⌂</b></div></div>
          <div className="promo-content"><span className="promo-label">New Feature</span><h2>Post Your <span>Property</span></h2><p>List your hostel property and reach more students effortlessly.</p><Link className="promo-button" to="/register?role=owner">Post Property <b>→</b></Link></div>
        </article>
        <article className="promo-card promo-filing landing-reveal">
          <div className="promo-illustration filing-illustration" aria-hidden="true"><div className="file-sheet"><b>FILING</b><i /><i /><i /><span>✓</span></div><div className="file-clock">◷</div></div>
          <div className="promo-content"><span className="promo-label">Stay organized</span><h2>Fast Filing</h2><p>Keep hostel records and reports organized in one place.</p><Link className="promo-button" to="/owner/more">File Now <b>→</b></Link></div>
        </article>
      </section>

      <section className="landing-about landing-reveal" id="about">
        <span className="about-rule" />
        <p>One simple place to manage hostel operations</p>
        <span className="about-rule" />
      </section>

      <footer className="landing-footer" id="contact">
        <Brand />
        <p>For hostel owners and students. Find a stay or manage your property with GoLiveHostel360.</p>
        <div className="row"><Link className="button secondary" to="/explore">Explore Hostels</Link><Link className="button primary" to="/login">Contact / Sign In</Link></div>
      </footer>
    </main>
  );
}

function PropertyCard({ hostel, favorite, onFavorite }: { hostel: Hostel; favorite?: boolean; onFavorite?: () => void }) {
  return (
    <Card className="property-card">
      {hostel.photos?.[0] ? <img className="property-photo" src={hostel.photos[0]} alt={hostel.name} /> : <div className="property-photo" />}
      <div className="spread"><h2>{hostel.name}</h2>{hostel.rating ? <span className="badge">★ {hostel.rating}</span> : null}</div>
      <p className="muted">{[hostel.area, hostel.city].filter(Boolean).join(", ") || hostel.address}</p>
      <div className="tag-row">
        {hostel.property_type && <span className="badge">{hostel.property_type}</span>}
        {hostel.gender && <span className="badge">{hostel.gender}</span>}
        {hostel.available_beds != null && <span className="badge success">{hostel.available_beds} beds available</span>}
      </div>
      <div className="row">
        <Link className="button primary" to={`/hostel/${encodeURIComponent(hostel.id)}`}>View details</Link>
        {onFavorite && <Button kind="secondary" onClick={onFavorite}>{favorite ? "♥ Saved" : "♡ Save"}</Button>}
      </div>
    </Card>
  );
}

export function ExplorePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState("all");
  const [sharing, setSharing] = useState("all");
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (gender !== "all") params.set("gender", gender);
    if (sharing !== "all") params.set("sharing", sharing);
    try {
      const result = await api.getPublic<{ hostels: Hostel[] }>(`/public/hostels?${params.toString()}`);
      setHostels(result.hostels);
      if (user) {
        const saved = await api.get<{ hostels: Hostel[] }>("/favorites");
        setFavorites(saved.hostels.map((item) => item.id));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load hostels."); }
    finally { setLoading(false); }
  }, [gender, query, sharing, user]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (id: string) => {
    if (!user) {
      navigate("/login");
      return;
    }
    const previous = favorites;
    setFavorites((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    try { await api.post(`/favorites/${encodeURIComponent(id)}`); }
    catch (reason) {
      setFavorites(previous);
      setError(reason instanceof Error ? reason.message : "Could not update saved hostels.");
    }
  };

  return (
    <Page title="Explore hostels" subtitle="Find your stay" actions={<Button kind="secondary" onClick={() => navigate("/account")}>Account</Button>}>
      <Card className="stack">
        <Field label="Search by name, city or area" value={query} onChange={setQuery} placeholder="Search hostels" />
        <div className="filter-row">
          <Field label="Hostel type" value={gender} onChange={setGender} options={["all", "boys", "girls", "co-living", "pg"]} />
          <Field label="Room sharing" value={sharing} onChange={setSharing} options={["all", "single", "double", "triple"]} />
          <Button kind="ghost" onClick={() => { setGender("all"); setSharing("all"); setQuery(""); }}>Reset filters</Button>
          <Button kind="secondary" onClick={() => navigate("/favorites")}>Saved hostels</Button>
        </div>
      </Card>
      {error && <AlertMessage tone="error">{error}</AlertMessage>}
      {loading ? <p className="muted">Finding hostels…</p> : hostels.length ? (
        <div className="grid">{hostels.map((hostel) => <PropertyCard key={hostel.id} hostel={hostel} favorite={favorites.includes(hostel.id)} onFavorite={() => void toggle(hostel.id)} />)}</div>
      ) : <Card><p>No hostels found. Try adjusting your filters or search a different city.</p></Card>}
    </Page>
  );
}

export function FavoritesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    api.get<{ hostels: Hostel[] }>("/favorites").then((result) => setHostels(result.hostels))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load saved hostels."));
  }, [user]);
  return <Page title="Saved Hostels" subtitle="Your shortlisted places">
    {error && <AlertMessage tone="error">{error}</AlertMessage>}
    {!user ? <Card className="stack"><p>Sign in to save hostels.</p><Button onClick={() => navigate("/login")}>Sign in</Button></Card>
      : hostels.length ? <div className="grid">{hostels.map((hostel) => <PropertyCard key={hostel.id} hostel={hostel} />)}</div>
        : <Card><p>No saved hostels yet. Tap the heart on any hostel to save it here.</p></Card>}
  </Page>;
}

export { AccountPage };

export function HostelDetailPage() {
  const { id = "" } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [hostel, setHostel] = useState<Hostel | null>(null);
  const [error, setError] = useState("");
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [enquiryType, setEnquiryType] = useState<"enquiry" | "site_visit" | "callback">("enquiry");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [message, setMessage] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate(`/login?propertyId=${encodeURIComponent(id)}`, { replace: true });
      return;
    }
    api.getPublic<{ hostel: Hostel }>(`/public/hostels/${encodeURIComponent(id)}`)
      .then((result) => setHostel(result.hostel))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load hostel."));
  }, [authLoading, id, navigate, user]);

  const sendEnquiry = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !mobile.trim()) {
      setError("Enter your name and mobile.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.post("/public/enquiry", {
        hostel_id: id,
        name: name.trim(),
        mobile: mobile.trim(),
        type: enquiryType,
        message,
        visit_date: visitDate,
      });
      setEnquiryOpen(false);
      setName(""); setMobile(""); setMessage(""); setVisitDate("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Failed to send request."); }
    finally { setBusy(false); }
  };

  if (!hostel) return <Page title="Hostel details">{error ? <AlertMessage tone="error">{error}</AlertMessage> : <p className="muted">Loading hostel…</p>}</Page>;
  const open = (type: typeof enquiryType) => { setEnquiryType(type); setEnquiryOpen(true); setError(""); };
  return <Page title={hostel.name} subtitle={[hostel.address, hostel.city].filter(Boolean).join(", ")}>
    {error && <AlertMessage tone="error">{error}</AlertMessage>}
    <Card className="stack">
      <div className="grid">{(hostel.photos?.length ? hostel.photos : [""]).map((photo, index) => photo ? <img className="property-photo" key={photo + index} src={photo} alt={`${hostel.name} ${index + 1}`} /> : <div className="property-photo" key={index} />)}</div>
      <div className="tag-row"><span className="badge">{hostel.property_type || "PG"}</span>{hostel.verification_status === "verified" && <span className="badge success">Admin Verified</span>}</div>
      <h2>Room Options</h2>
      {hostel.room_options?.map((room, index) => <div className="spread" key={index}><span>{room.bed_count} {room.bed_count === 1 ? "Bed" : "Beds"}</span><b>₹{room.rent}/mo</b></div>)}
      <h2>Amenities</h2><div className="tag-row">{hostel.amenities?.map((item) => <span className="badge" key={item}>{item}</span>)}</div>
      <h2>Ratings & Reviews</h2>
      {hostel.reviews?.length ? hostel.reviews.map((review) => <div key={review.id}><b>{review.name || "Guest"} · {"★".repeat(review.rating)}</b><p>{review.comment}</p></div>) : <p className="muted">No reviews yet.</p>}
      <div className="row">
        <Button kind="secondary" onClick={() => open("site_visit")}>Site Visit</Button>
        <Button kind="ghost" onClick={() => open("callback")}>Request Callback</Button>
        <Button onClick={() => open("enquiry")}>Send Enquiry</Button>
        {hostel.mobile && <a className="button secondary" href={`tel:${hostel.mobile}`}>Call</a>}
      </div>
    </Card>
    {enquiryOpen && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label="Send request">
      <div className="spread"><h2>{enquiryType === "site_visit" ? "Book a Site Visit" : enquiryType === "callback" ? "Request Callback" : "Send Enquiry"}</h2><Button kind="ghost" onClick={() => setEnquiryOpen(false)}>Close</Button></div>
      <form className="form" onSubmit={(event) => void sendEnquiry(event)}>
        <Field label="Name" value={name} onChange={setName} required />
        <Field label="Mobile" value={mobile} onChange={setMobile} type="tel" required />
        {enquiryType === "site_visit" && <Field label="Visit date" value={visitDate} onChange={setVisitDate} type="date" />}
        {enquiryType === "enquiry" && <Field label="Message" value={message} onChange={setMessage} multiline />}
        {error && <AlertMessage tone="error">{error}</AlertMessage>}
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Submit request"}</Button>
      </form>
    </section></div>}
  </Page>;
}

export function TenantApplicationPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [hostel, setHostel] = useState<{ id: string; name: string; city?: string; area?: string } | null>(null);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [preferences, setPreferences] = useState("");
  const [loading, setLoading] = useState(Boolean(token));
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("This registration link is invalid or incomplete.");
      setLoading(false);
      return;
    }
    api.getPublic<{ hostel: NonNullable<typeof hostel> }>(`/public/tenant-registration?token=${encodeURIComponent(token)}`)
      .then((result) => setHostel(result.hostel))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "This registration link is unavailable."))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !/^\+?[\d\s()-]+$/.test(mobile.trim()) || mobile.replace(/\D/g, "").length !== 10) {
      setError("Enter your full name and a valid 10-digit mobile number.");
      return;
    }
    setError("");
    try {
      await api.postPublic(`/public/tenant-applications?token=${encodeURIComponent(token)}`, {
        name: name.trim(), mobile: mobile.trim(), email: email.trim() || undefined, preferences: preferences.trim() || undefined,
      });
      setSubmitted(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit your application."); }
  };

  return <Page title="Tenant registration" subtitle={hostel?.name || "Hostel360"}>
    {loading && <p className="muted">Loading registration…</p>}
    {error && <AlertMessage tone="error">{error}</AlertMessage>}
    {hostel && submitted ? <Card className="stack"><h2>Application submitted</h2><p>Your application for {hostel.name} has been sent to the hostel owner for review.</p><p className="muted">This is a pending application, not an active tenant registration. No room or bed has been assigned.</p></Card> : null}
    {hostel && !submitted ? <Card className="stack">
      <p>Applying to {hostel.name} · {[hostel.area, hostel.city].filter(Boolean).join(", ")}</p>
      <p className="muted">Submit your details for owner review. A room is not reserved by this application.</p>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <Field label="Full name" value={name} onChange={setName} required />
        <Field label="Mobile" value={mobile} onChange={setMobile} type="tel" required />
        <Field label="Email (optional)" value={email} onChange={setEmail} type="email" />
        <Field label="Room or stay preferences (optional)" value={preferences} onChange={setPreferences} multiline maxLength={500} placeholder="Preferred sharing, move-in timing, or other requests" />
        <Button type="submit">Submit application</Button>
      </form>
    </Card> : null}
  </Page>;
}
