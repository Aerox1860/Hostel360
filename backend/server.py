import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Literal

import bcrypt
import jwt
import httpx
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, status, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hostel360")

# ---------------- DB ----------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ.get("JWT_SECRET", "hostel360-dev-secret")
JWT_ALGO = "HS256"
TOKEN_DAYS = 30
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@hostel360.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin@12345")
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
TRIAL_DAYS = int(os.environ.get("TRIAL_DAYS", "45"))
BACKEND_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "")

# ---------------- Subscription pricing (bed-slab, INR rupees) ----------------
# Each slab: (max_beds, {months: price_in_rupees}). Last slab (131+) has max=None.
PRICE_SLABS = [
    (40, "Up to 40 beds", {1: 299, 3: 799, 6: 1499, 12: 2499}),
    (70, "41 – 70 beds", {1: 499, 3: 1299, 6: 2499, 12: 4499}),
    (100, "71 – 100 beds", {1: 699, 3: 1899, 6: 3699, 12: 6999}),
    (130, "101 – 130 beds", {1: 999, 3: 2699, 6: 5199, 12: 9999}),
    (None, "131+ beds", {1: 1499, 3: 3999, 6: 7999, 12: 14999}),
]


def slab_for_beds(beds: int):
    for max_beds, label, prices in PRICE_SLABS:
        if max_beds is None or beds <= max_beds:
            return {"label": label, "prices": prices, "max_beds": max_beds}
    return {"label": PRICE_SLABS[-1][1], "prices": PRICE_SLABS[-1][2], "max_beds": None}


def _rzp_ready() -> bool:
    return bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_ID.startswith("rzp_") and RAZORPAY_KEY_SECRET)


def add_months(dt: datetime, months: int) -> datetime:
    try:
        from dateutil.relativedelta import relativedelta
        return dt + relativedelta(months=+months)
    except Exception:
        return dt + timedelta(days=30 * months)

app = FastAPI(title="Hostel 360 API")
api = APIRouter(prefix="/api")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_pw(pw: str, hashed: Optional[str]) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except Exception:
        return False


def make_token(user: dict) -> str:
    claims = {
        "sub": user["id"],
        "role": user["role"],
        "iat": now_utc(),
        "exp": now_utc() + timedelta(days=TOKEN_DAYS),
    }
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGO)


def clean(doc: dict) -> dict:
    if doc and "_id" in doc:
        doc = {k: v for k, v in doc.items() if k != "_id"}
    return doc


def public_user(u: dict) -> dict:
    return {
        "id": u["id"],
        "email": u.get("email"),
        "name": u.get("name"),
        "mobile": u.get("mobile"),
        "role": u.get("role"),
        "hostel_id": u.get("hostel_id"),
        "blocked": u.get("blocked", False),
        "active": u.get("active", True),
        "auth_provider": u.get("auth_provider", "password"),
    }


# ---------------- Auth deps ----------------
async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    token = None
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    user = None
    # Try JWT first
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        user = await db.users.find_one({"id": claims.get("sub")}, {"_id": 0})
    except jwt.PyJWTError:
        user = None
    # Fallback: google session token
    if not user:
        sess = await db.user_sessions.find_one({"session_token": token})
        if sess:
            exp = sess.get("expires_at")
            if exp and exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp and exp > now_utc():
                user = await db.users.find_one({"id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if user.get("blocked"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account blocked")
    return user


def require_roles(*roles: str):
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permission")
        return user
    return dep


# ---------------- Schemas ----------------
class RegisterBody(BaseModel):
    email: EmailStr
    password: str
    name: str
    mobile: Optional[str] = None
    role: Literal["owner", "tenant"] = "tenant"


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class SessionBody(BaseModel):
    session_id: str


# ---------------- Auth routes ----------------
@api.post("/auth/register")
async def register(body: RegisterBody):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(409, "An account already exists for this email")
    user = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_pw(body.password),
        "name": body.name,
        "mobile": body.mobile,
        "role": body.role,  # only owner/tenant allowed via schema
        "auth_provider": "password",
        "blocked": False,
        "active": True,
        "hostel_id": None,
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user)
    return {"access_token": make_token(user), "user": public_user(user)}


@api.post("/auth/login")
async def login(body: LoginBody):
    email = body.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_pw(body.password, user.get("password_hash")):
        raise HTTPException(401, "Incorrect email or password")
    if user.get("blocked"):
        raise HTTPException(403, "Your account has been blocked. Contact admin.")
    return {"access_token": make_token(user), "user": public_user(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": public_user(user)}


@api.post("/auth/session")
async def google_session(body: SessionBody):
    async with httpx.AsyncClient() as hc:
        r = await hc.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
            timeout=15,
        )
    if r.status_code != 200:
        raise HTTPException(401, "Invalid session")
    data = r.json()
    email = (data.get("email") or "").lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user = {
            "id": new_id(),
            "email": email,
            "name": data.get("name"),
            "mobile": None,
            "role": "tenant",
            "auth_provider": "google",
            "picture": data.get("picture"),
            "blocked": False,
            "active": True,
            "hostel_id": None,
            "created_at": now_utc().isoformat(),
        }
        await db.users.insert_one(user)
    session_token = data.get("session_token") or new_id()
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user["id"],
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })
    return {"session_token": session_token, "access_token": session_token, "user": public_user(user)}


# ---------------- Public routes ----------------
@api.get("/public/hostels")
async def public_hostels(
    city: Optional[str] = None,
    area: Optional[str] = None,
    gender: Optional[str] = None,
    sharing: Optional[str] = None,
    max_budget: Optional[int] = None,
    q: Optional[str] = None,
):
    query: dict = {"status": "approved"}
    if city:
        query["city"] = {"$regex": city, "$options": "i"}
    if area:
        query["area"] = {"$regex": area, "$options": "i"}
    if gender and gender != "all":
        query["gender"] = gender
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"city": {"$regex": q, "$options": "i"}},
            {"area": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.hostels.find(query, {"_id": 0}).to_list(200)
    result = []
    for h in docs:
        if max_budget and h.get("min_rent") and h["min_rent"] > max_budget:
            continue
        if sharing and sharing != "all" and sharing not in (h.get("sharing_types") or []):
            continue
        result.append(h)
    return {"hostels": result}


@api.get("/public/hostels/{hostel_id}")
async def public_hostel_detail(hostel_id: str):
    h = await db.hostels.find_one({"id": hostel_id}, {"_id": 0})
    if not h:
        raise HTTPException(404, "Hostel not found")
    reviews = await db.reviews.find({"hostel_id": hostel_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    rooms = await db.rooms.find({"hostel_id": hostel_id}, {"_id": 0}).to_list(200)
    available = 0
    for r in rooms:
        available += sum(1 for b in r.get("beds", []) if b.get("status") == "available")
    h["reviews"] = reviews
    h["available_beds"] = available
    h["room_options"] = [
        {"room_type": r.get("room_type"), "rent": r.get("rent")} for r in rooms
    ]
    return {"hostel": h}


class EnquiryBody(BaseModel):
    hostel_id: str
    name: str
    mobile: str
    type: Literal["enquiry", "site_visit", "callback"] = "enquiry"
    message: Optional[str] = None
    visit_date: Optional[str] = None


@api.post("/public/enquiry")
async def create_enquiry(body: EnquiryBody):
    h = await db.hostels.find_one({"id": body.hostel_id})
    if not h:
        raise HTTPException(404, "Hostel not found")
    doc = {"id": new_id(), **body.dict(), "hostel_name": h.get("name"),
           "owner_id": h.get("owner_id"), "status": "new", "created_at": now_utc().isoformat()}
    await db.enquiries.insert_one(doc)
    return {"ok": True, "enquiry": clean(doc)}


class ReviewBody(BaseModel):
    hostel_id: str
    rating: int
    comment: Optional[str] = None


@api.post("/public/review")
async def add_review(body: ReviewBody, user: dict = Depends(get_current_user)):
    doc = {"id": new_id(), "hostel_id": body.hostel_id, "rating": max(1, min(5, body.rating)),
           "comment": body.comment, "name": user.get("name"), "created_at": now_utc().isoformat()}
    await db.reviews.insert_one(doc)
    # recompute average
    revs = await db.reviews.find({"hostel_id": body.hostel_id}, {"_id": 0}).to_list(1000)
    avg = round(sum(r["rating"] for r in revs) / len(revs), 1) if revs else 0
    await db.hostels.update_one({"id": body.hostel_id}, {"$set": {"rating": avg, "reviews_count": len(revs)}})
    return {"ok": True, "review": clean(doc)}


# Favorites (auth)
@api.get("/favorites")
async def list_favorites(user: dict = Depends(get_current_user)):
    favs = await db.favorites.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
    ids = [f["hostel_id"] for f in favs]
    hostels = await db.hostels.find({"id": {"$in": ids}}, {"_id": 0}).to_list(200)
    return {"hostels": hostels}


@api.post("/favorites/{hostel_id}")
async def toggle_favorite(hostel_id: str, user: dict = Depends(get_current_user)):
    existing = await db.favorites.find_one({"user_id": user["id"], "hostel_id": hostel_id})
    if existing:
        await db.favorites.delete_one({"user_id": user["id"], "hostel_id": hostel_id})
        return {"favorited": False}
    await db.favorites.insert_one({"id": new_id(), "user_id": user["id"], "hostel_id": hostel_id})
    return {"favorited": True}


# ---------------- Admin routes ----------------
@api.get("/admin/dashboard")
async def admin_dashboard(user: dict = Depends(require_roles("admin"))):
    hostels = await db.hostels.find({}, {"_id": 0}).to_list(2000)
    owners = await db.users.find({"role": "owner"}, {"_id": 0}).to_list(2000)
    subs = await db.subscriptions.find({}, {"_id": 0}).to_list(5000)
    total_revenue = sum(s.get("amount", 0) for s in subs if s.get("status") in ("active", "expired"))
    active_subs = [s for s in subs if s.get("status") == "active"]
    expired_subs = [s for s in subs if s.get("status") == "expired"]
    return {
        "total_hostels": len(hostels),
        "total_owners": len(owners),
        "active_owners": len([o for o in owners if o.get("active") and not o.get("blocked")]),
        "inactive_owners": len([o for o in owners if (not o.get("active")) or o.get("blocked")]),
        "premium_plans": len(active_subs),
        "total_revenue": round(total_revenue, 2),
        "expired_plans": len(expired_subs),
        "new_registrations": len([h for h in hostels if h.get("status") == "pending"]),
        "pending_verification": len([h for h in hostels if h.get("status") == "pending"]),
    }


@api.get("/admin/hostels")
async def admin_hostels(status_filter: Optional[str] = None, user: dict = Depends(require_roles("admin"))):
    query = {}
    if status_filter and status_filter != "all":
        query["status"] = status_filter
    hostels = await db.hostels.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return {"hostels": hostels}


class VerifyBody(BaseModel):
    action: Literal["approve", "reject", "suspend", "reactivate"]
    site_visit_status: Optional[str] = None
    note: Optional[str] = None


@api.post("/admin/hostels/{hostel_id}/verify")
async def verify_hostel(hostel_id: str, body: VerifyBody, user: dict = Depends(require_roles("admin"))):
    h = await db.hostels.find_one({"id": hostel_id})
    if not h:
        raise HTTPException(404, "Hostel not found")
    status_map = {"approve": "approved", "reject": "rejected", "suspend": "suspended", "reactivate": "approved"}
    update = {
        "status": status_map[body.action],
        "verification_status": "verified" if body.action in ("approve", "reactivate") else h.get("verification_status", "pending"),
        "verified_at": now_utc().isoformat(),
    }
    if body.site_visit_status:
        update["site_visit_status"] = body.site_visit_status
    if body.note is not None:
        update["admin_note"] = body.note
    await db.hostels.update_one({"id": hostel_id}, {"$set": update})
    h2 = await db.hostels.find_one({"id": hostel_id}, {"_id": 0})
    return {"ok": True, "hostel": h2}


@api.get("/admin/owners")
async def admin_owners(user: dict = Depends(require_roles("admin"))):
    owners = await db.users.find({"role": "owner"}, {"_id": 0, "password_hash": 0}).to_list(2000)
    for o in owners:
        o["hostels"] = await db.hostels.count_documents({"owner_id": o["id"]})
    return {"owners": owners}


class OwnerActionBody(BaseModel):
    action: Literal["activate", "deactivate", "block", "unblock", "reset_password"]
    new_password: Optional[str] = None


@api.post("/admin/owners/{owner_id}/action")
async def owner_action(owner_id: str, body: OwnerActionBody, user: dict = Depends(require_roles("admin"))):
    o = await db.users.find_one({"id": owner_id, "role": "owner"})
    if not o:
        raise HTTPException(404, "Owner not found")
    update = {}
    if body.action == "activate":
        update["active"] = True
    elif body.action == "deactivate":
        update["active"] = False
    elif body.action == "block":
        update["blocked"] = True
    elif body.action == "unblock":
        update["blocked"] = False
    elif body.action == "reset_password":
        pw = body.new_password or "Reset@12345"
        update["password_hash"] = hash_pw(pw)
        await db.users.update_one({"id": owner_id}, {"$set": update})
        return {"ok": True, "new_password": pw}
    await db.users.update_one({"id": owner_id}, {"$set": update})
    return {"ok": True}


# Subscription plans (admin managed)
class PlanBody(BaseModel):
    name: str
    duration_months: int
    price: float
    features: List[str] = []
    active: bool = True


@api.get("/plans")
async def list_plans(active_only: bool = False):
    query = {"active": True} if active_only else {}
    plans = await db.plans.find(query, {"_id": 0}).sort("duration_months", 1).to_list(100)
    return {"plans": plans}


@api.post("/admin/plans")
async def create_plan(body: PlanBody, user: dict = Depends(require_roles("admin"))):
    doc = {"id": new_id(), **body.dict(), "created_at": now_utc().isoformat()}
    await db.plans.insert_one(doc)
    return {"plan": clean(doc)}


@api.put("/admin/plans/{plan_id}")
async def update_plan(plan_id: str, body: PlanBody, user: dict = Depends(require_roles("admin"))):
    await db.plans.update_one({"id": plan_id}, {"$set": body.dict()})
    p = await db.plans.find_one({"id": plan_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Plan not found")
    return {"plan": p}


@api.post("/admin/plans/{plan_id}/toggle")
async def toggle_plan(plan_id: str, user: dict = Depends(require_roles("admin"))):
    p = await db.plans.find_one({"id": plan_id})
    if not p:
        raise HTTPException(404, "Plan not found")
    await db.plans.update_one({"id": plan_id}, {"$set": {"active": not p.get("active", True)}})
    return {"active": not p.get("active", True)}


# ---------------- Owner routes ----------------
async def get_owner_hostel(user: dict, hostel_id: Optional[str] = None) -> Optional[dict]:
    """Resolve the hostel an owner is acting on.
    If hostel_id is given it must belong to the owner; otherwise fall back to
    the owner's first hostel (for backward compatibility)."""
    if hostel_id:
        return await db.hostels.find_one({"id": hostel_id, "owner_id": user["id"]}, {"_id": 0})
    return await db.hostels.find_one({"owner_id": user["id"]}, {"_id": 0})


async def hostel_owned(user: dict, hostel_id: str) -> Optional[dict]:
    return await db.hostels.find_one({"id": hostel_id, "owner_id": user["id"]}, {"_id": 0})


class HostelBody(BaseModel):
    name: str
    pg_name: Optional[str] = None
    owner_name: str
    mobile: str
    address: str
    city: str
    state: str
    area: Optional[str] = None
    google_location: Optional[str] = None
    gender: Literal["boys", "girls", "co-living", "pg"] = "pg"
    photos: List[str] = []
    amenities: List[str] = []
    sharing_types: List[str] = []
    ownership_proof: Optional[str] = None
    min_rent: Optional[int] = None


@api.get("/owner/hostels")
async def owner_list_hostels(user: dict = Depends(require_roles("owner"))):
    hostels = await db.hostels.find({"owner_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"hostels": hostels}


@api.get("/owner/portfolio")
async def owner_portfolio(user: dict = Depends(require_roles("owner"))):
    hostels = await db.hostels.find({"owner_id": user["id"]}, {"_id": 0}).to_list(200)
    hids = [h["id"] for h in hostels]
    rooms = await db.rooms.find({"hostel_id": {"$in": hids}}, {"_id": 0}).to_list(5000)
    tenants = await db.tenants.find({"hostel_id": {"$in": hids}, "active": True}, {"_id": 0}).to_list(5000)
    payments = await db.payments.find({"hostel_id": {"$in": hids}, "status": "paid"}, {"_id": 0}).to_list(20000)
    expenses = await db.expenses.find({"hostel_id": {"$in": hids}}, {"_id": 0}).to_list(20000)
    total_beds = sum(len(r.get("beds", [])) for r in rooms)
    occupied = sum(1 for r in rooms for b in r.get("beds", []) if b.get("status") == "occupied")
    total_collection = sum(p.get("amount", 0) for p in payments)
    total_expenses = sum(e.get("amount", 0) for e in expenses)
    per_hostel = []
    for h in hostels:
        hr = [r for r in rooms if r["hostel_id"] == h["id"]]
        hb = sum(len(r.get("beds", [])) for r in hr)
        ho = sum(1 for r in hr for b in r.get("beds", []) if b.get("status") == "occupied")
        per_hostel.append({
            "id": h["id"], "name": h["name"], "status": h.get("status"),
            "beds": hb, "occupied": ho,
            "tenants": len([t for t in tenants if t["hostel_id"] == h["id"]]),
            "occupancy_pct": round((ho / hb * 100), 0) if hb else 0,
        })
    return {
        "total_hostels": len(hostels),
        "approved_hostels": len([h for h in hostels if h.get("status") == "approved"]),
        "pending_hostels": len([h for h in hostels if h.get("status") == "pending"]),
        "total_beds": total_beds,
        "occupied_beds": occupied,
        "available_beds": total_beds - occupied,
        "total_tenants": len(tenants),
        "total_collection": round(total_collection, 2),
        "total_expenses": round(total_expenses, 2),
        "net_profit": round(total_collection - total_expenses, 2),
        "occupancy_pct": round((occupied / total_beds * 100), 0) if total_beds else 0,
        "per_hostel": per_hostel,
    }


@api.get("/owner/hostel")
async def owner_get_hostel(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    return {"hostel": h}


@api.post("/owner/hostel")
async def owner_create_hostel(body: HostelBody, user: dict = Depends(require_roles("owner"))):
    doc = {
        "id": new_id(),
        "owner_id": user["id"],
        **body.dict(),
        "status": "pending",
        "verification_status": "pending",
        "site_visit_status": "not_verified",
        "identity_verified": False,
        "premium_plan": None,
        "plan_expiry": None,
        "trial_ends_at": (now_utc() + timedelta(days=TRIAL_DAYS)).isoformat(),
        "rating": 0,
        "reviews_count": 0,
        "created_at": now_utc().isoformat(),
    }
    await db.hostels.insert_one(doc)
    return {"hostel": clean(doc)}


@api.put("/owner/hostel/{hostel_id}")
async def owner_update_hostel(hostel_id: str, body: HostelBody, user: dict = Depends(require_roles("owner"))):
    h = await hostel_owned(user, hostel_id)
    if not h:
        raise HTTPException(404, "Hostel not found")
    await db.hostels.update_one({"id": hostel_id}, {"$set": body.dict()})
    h2 = await db.hostels.find_one({"id": hostel_id}, {"_id": 0})
    return {"hostel": h2}


@api.get("/owner/dashboard")
async def owner_dashboard(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"has_hostel": False}
    hid = h["id"]
    rooms = await db.rooms.find({"hostel_id": hid}, {"_id": 0}).to_list(1000)
    tenants = await db.tenants.find({"hostel_id": hid, "active": True}, {"_id": 0}).to_list(2000)
    total_beds = sum(len(r.get("beds", [])) for r in rooms)
    occupied = sum(1 for r in rooms for b in r.get("beds", []) if b.get("status") == "occupied")
    vacant_rooms = sum(1 for r in rooms if all(b.get("status") == "available" for b in r.get("beds", [])))
    today = now_utc().date().isoformat()
    checkins = [t for t in tenants if (t.get("joining_date") or "")[:10] == today]
    # payments this month
    ym = now_utc().strftime("%Y-%m")
    payments = await db.payments.find({"hostel_id": hid}, {"_id": 0}).to_list(5000)
    month_collection = sum(p.get("amount", 0) for p in payments if (p.get("date") or "")[:7] == ym and p.get("status") == "paid")
    expenses = await db.expenses.find({"hostel_id": hid}, {"_id": 0}).to_list(5000)
    month_expenses = sum(e.get("amount", 0) for e in expenses if (e.get("date") or "")[:7] == ym)
    pending = [t for t in tenants if t.get("payment_status") == "due"]
    upcoming_due = sum(t.get("monthly_rent", 0) for t in pending)
    return {
        "has_hostel": True,
        "hostel_status": h.get("status"),
        "total_rooms": len(rooms),
        "total_beds": total_beds,
        "occupied_beds": occupied,
        "available_beds": total_beds - occupied,
        "total_tenants": len(tenants),
        "vacant_rooms": vacant_rooms,
        "today_checkins": len(checkins),
        "today_checkouts": 0,
        "upcoming_rent_due": round(upcoming_due, 2),
        "monthly_collection": round(month_collection, 2),
        "monthly_expenses": round(month_expenses, 2),
        "monthly_profit": round(month_collection - month_expenses, 2),
        "pending_payments": len(pending),
        "occupancy_pct": round((occupied / total_beds * 100), 0) if total_beds else 0,
        "subscription": compute_sub_status(h),
    }


# Rooms
class RoomBody(BaseModel):
    hostel_id: Optional[str] = None
    floor: str
    room_number: str
    room_type: Literal["single", "double", "triple", "dormitory"] = "double"
    rent: int
    bed_count: int = 2


@api.get("/owner/rooms")
async def owner_rooms(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"rooms": []}
    rooms = await db.rooms.find({"hostel_id": h["id"]}, {"_id": 0}).to_list(1000)
    return {"rooms": rooms}


@api.post("/owner/rooms")
async def owner_add_room(body: RoomBody, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, body.hostel_id)
    if not h:
        raise HTTPException(400, "Create your hostel first")
    beds = [{"bed_number": f"{body.room_number}-{i+1}", "status": "available", "tenant_id": None}
            for i in range(max(1, body.bed_count))]
    doc = {"id": new_id(), "hostel_id": h["id"], "floor": body.floor, "room_number": body.room_number,
           "room_type": body.room_type, "rent": body.rent, "beds": beds, "created_at": now_utc().isoformat()}
    await db.rooms.insert_one(doc)
    # update min rent + sharing
    await _refresh_hostel_meta(h["id"])
    return {"room": clean(doc)}


@api.delete("/owner/rooms/{room_id}")
async def owner_delete_room(room_id: str, user: dict = Depends(require_roles("owner"))):
    room = await db.rooms.find_one({"id": room_id})
    if not room or not await hostel_owned(user, room["hostel_id"]):
        raise HTTPException(404, "Room not found")
    if any(b.get("status") == "occupied" for b in room.get("beds", [])):
        raise HTTPException(400, "Room has occupied beds")
    await db.rooms.delete_one({"id": room_id})
    await _refresh_hostel_meta(room["hostel_id"])
    return {"ok": True}


async def _refresh_hostel_meta(hostel_id: str):
    rooms = await db.rooms.find({"hostel_id": hostel_id}, {"_id": 0}).to_list(1000)
    if not rooms:
        await db.hostels.update_one({"id": hostel_id}, {"$set": {"min_rent": None, "sharing_types": []}})
        return
    min_rent = min(r.get("rent", 0) for r in rooms)
    type_map = {"single": "single", "double": "double", "triple": "triple", "dormitory": "triple"}
    sharing = sorted({type_map.get(r.get("room_type"), "double") for r in rooms})
    await db.hostels.update_one({"id": hostel_id}, {"$set": {"min_rent": min_rent, "sharing_types": sharing}})


# Tenants
class TenantBody(BaseModel):
    hostel_id: Optional[str] = None
    name: str
    mobile: str
    email: Optional[EmailStr] = None
    room_id: str
    bed_number: str
    joining_date: str
    monthly_rent: int
    security_deposit: int = 0
    advance_amount: int = 0
    create_login: bool = False
    password: Optional[str] = None


@api.get("/owner/tenants")
async def owner_tenants(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"tenants": []}
    tenants = await db.tenants.find({"hostel_id": h["id"]}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return {"tenants": tenants}


@api.post("/owner/tenants")
async def owner_add_tenant(body: TenantBody, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, body.hostel_id)
    if not h:
        raise HTTPException(400, "Create your hostel first")
    room = await db.rooms.find_one({"id": body.room_id, "hostel_id": h["id"]})
    if not room:
        raise HTTPException(404, "Room not found")
    bed = next((b for b in room.get("beds", []) if b["bed_number"] == body.bed_number), None)
    if not bed:
        raise HTTPException(404, "Bed not found")
    if bed.get("status") == "occupied":
        raise HTTPException(400, "Bed already occupied")

    user_id = None
    if body.create_login and body.email:
        exists = await db.users.find_one({"email": body.email.lower()})
        if exists:
            user_id = exists["id"]
        else:
            tu = {"id": new_id(), "email": body.email.lower(),
                  "password_hash": hash_pw(body.password or "Tenant@12345"),
                  "name": body.name, "mobile": body.mobile, "role": "tenant",
                  "auth_provider": "password", "blocked": False, "active": True,
                  "hostel_id": h["id"], "created_at": now_utc().isoformat()}
            await db.users.insert_one(tu)
            user_id = tu["id"]

    tenant = {
        "id": new_id(),
        "hostel_id": h["id"],
        "user_id": user_id,
        "tenant_code": "T" + new_id()[:6].upper(),
        "name": body.name,
        "mobile": body.mobile,
        "email": body.email,
        "room_id": body.room_id,
        "room_number": room["room_number"],
        "bed_number": body.bed_number,
        "joining_date": body.joining_date,
        "monthly_rent": body.monthly_rent,
        "security_deposit": body.security_deposit,
        "advance_amount": body.advance_amount,
        "payment_status": "due",
        "active": True,
        "created_at": now_utc().isoformat(),
    }
    await db.tenants.insert_one(tenant)
    # occupy bed
    await db.rooms.update_one(
        {"id": body.room_id, "beds.bed_number": body.bed_number},
        {"$set": {"beds.$.status": "occupied", "beds.$.tenant_id": tenant["id"]}},
    )
    if user_id:
        await db.users.update_one({"id": user_id}, {"$set": {"hostel_id": h["id"], "tenant_id": tenant["id"]}})
    return {"tenant": clean(tenant), "login_password": body.password if body.create_login else None}


@api.put("/owner/tenants/{tenant_id}")
async def owner_edit_tenant(tenant_id: str, body: dict, user: dict = Depends(require_roles("owner"))):
    t = await db.tenants.find_one({"id": tenant_id})
    if not t or not await hostel_owned(user, t["hostel_id"]):
        raise HTTPException(404, "Tenant not found")
    allowed = {k: body[k] for k in ("name", "mobile", "monthly_rent", "security_deposit", "advance_amount") if k in body}
    await db.tenants.update_one({"id": tenant_id}, {"$set": allowed})
    t2 = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    return {"tenant": t2}


class TransferBody(BaseModel):
    room_id: str
    bed_number: str


@api.post("/owner/tenants/{tenant_id}/transfer")
async def owner_transfer_tenant(tenant_id: str, body: TransferBody, user: dict = Depends(require_roles("owner"))):
    t = await db.tenants.find_one({"id": tenant_id})
    if not t or not await hostel_owned(user, t["hostel_id"]):
        raise HTTPException(404, "Tenant not found")
    new_room = await db.rooms.find_one({"id": body.room_id, "hostel_id": t["hostel_id"]})
    if not new_room:
        raise HTTPException(404, "Room not found")
    nb = next((b for b in new_room.get("beds", []) if b["bed_number"] == body.bed_number), None)
    if not nb or nb.get("status") == "occupied":
        raise HTTPException(400, "Bed not available")
    # free old bed
    await db.rooms.update_one({"id": t["room_id"], "beds.bed_number": t["bed_number"]},
                              {"$set": {"beds.$.status": "available", "beds.$.tenant_id": None}})
    # occupy new
    await db.rooms.update_one({"id": body.room_id, "beds.bed_number": body.bed_number},
                             {"$set": {"beds.$.status": "occupied", "beds.$.tenant_id": tenant_id}})
    await db.tenants.update_one({"id": tenant_id}, {"$set": {
        "room_id": body.room_id, "room_number": new_room["room_number"],
        "bed_number": body.bed_number, "monthly_rent": new_room.get("rent", t["monthly_rent"])}})
    t2 = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    return {"tenant": t2}


@api.post("/owner/tenants/{tenant_id}/checkout")
async def owner_checkout_tenant(tenant_id: str, user: dict = Depends(require_roles("owner"))):
    t = await db.tenants.find_one({"id": tenant_id})
    if not t or not await hostel_owned(user, t["hostel_id"]):
        raise HTTPException(404, "Tenant not found")
    await db.rooms.update_one({"id": t["room_id"], "beds.bed_number": t["bed_number"]},
                              {"$set": {"beds.$.status": "available", "beds.$.tenant_id": None}})
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"active": False, "checkout_date": now_utc().isoformat()}})
    return {"ok": True}


@api.delete("/owner/tenants/{tenant_id}")
async def owner_delete_tenant(tenant_id: str, user: dict = Depends(require_roles("owner"))):
    t = await db.tenants.find_one({"id": tenant_id})
    if not t or not await hostel_owned(user, t["hostel_id"]):
        raise HTTPException(404, "Tenant not found")
    if t.get("active"):
        await db.rooms.update_one({"id": t["room_id"], "beds.bed_number": t["bed_number"]},
                                  {"$set": {"beds.$.status": "available", "beds.$.tenant_id": None}})
    await db.tenants.delete_one({"id": tenant_id})
    return {"ok": True}


# Rent
class RentBody(BaseModel):
    tenant_id: str
    amount: int
    type: Literal["rent", "advance", "deposit"] = "rent"
    method: str = "cash"
    note: Optional[str] = None


def _receipt_no() -> str:
    return "RCPT-" + now_utc().strftime("%y%m") + "-" + new_id()[:5].upper()


@api.get("/owner/rent")
async def owner_rent(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"payments": [], "tenants": []}
    payments = await db.payments.find({"hostel_id": h["id"]}, {"_id": 0}).sort("date", -1).to_list(5000)
    tenants = await db.tenants.find({"hostel_id": h["id"], "active": True}, {"_id": 0}).to_list(2000)
    return {"payments": payments, "tenants": tenants}


@api.post("/owner/rent")
async def owner_collect_rent(body: RentBody, user: dict = Depends(require_roles("owner"))):
    t = await db.tenants.find_one({"id": body.tenant_id})
    if not t or not await hostel_owned(user, t["hostel_id"]):
        raise HTTPException(404, "Tenant not found")
    doc = {"id": new_id(), "hostel_id": t["hostel_id"], "tenant_id": body.tenant_id,
           "tenant_name": t["name"], "amount": body.amount, "type": body.type,
           "method": body.method, "note": body.note, "receipt_no": _receipt_no(),
           "status": "paid", "date": now_utc().isoformat(), "created_at": now_utc().isoformat()}
    await db.payments.insert_one(doc)
    if body.type == "rent":
        await db.tenants.update_one({"id": body.tenant_id}, {"$set": {"payment_status": "paid", "last_paid": now_utc().isoformat()}})
    return {"payment": clean(doc)}


# Expenses
class ExpenseBody(BaseModel):
    hostel_id: Optional[str] = None
    category: Literal["electricity", "water", "internet", "gas", "staff_salary", "food", "maintenance", "repairs", "other"]
    amount: int
    note: Optional[str] = None
    date: Optional[str] = None


@api.get("/owner/expenses")
async def owner_get_expenses(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"expenses": []}
    expenses = await db.expenses.find({"hostel_id": h["id"]}, {"_id": 0}).sort("date", -1).to_list(5000)
    return {"expenses": expenses}


@api.post("/owner/expenses")
async def owner_add_expense(body: ExpenseBody, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, body.hostel_id)
    if not h:
        raise HTTPException(400, "Create your hostel first")
    doc = {"id": new_id(), "hostel_id": h["id"], "category": body.category, "amount": body.amount,
           "note": body.note, "date": body.date or now_utc().isoformat(), "created_at": now_utc().isoformat()}
    await db.expenses.insert_one(doc)
    return {"expense": clean(doc)}


@api.delete("/owner/expenses/{expense_id}")
async def owner_delete_expense(expense_id: str, user: dict = Depends(require_roles("owner"))):
    e = await db.expenses.find_one({"id": expense_id})
    if e and await hostel_owned(user, e["hostel_id"]):
        await db.expenses.delete_one({"id": expense_id})
    return {"ok": True}


@api.get("/owner/reports")
async def owner_reports(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"has_hostel": False}
    payments = await db.payments.find({"hostel_id": h["id"], "status": "paid"}, {"_id": 0}).to_list(10000)
    expenses = await db.expenses.find({"hostel_id": h["id"]}, {"_id": 0}).to_list(10000)
    rooms = await db.rooms.find({"hostel_id": h["id"]}, {"_id": 0}).to_list(1000)
    tenants = await db.tenants.find({"hostel_id": h["id"], "active": True}, {"_id": 0}).to_list(2000)
    total_beds = sum(len(r.get("beds", [])) for r in rooms)
    occupied = sum(1 for r in rooms for b in r.get("beds", []) if b.get("status") == "occupied")
    total_collection = sum(p.get("amount", 0) for p in payments)
    total_expenses = sum(e.get("amount", 0) for e in expenses)
    # monthly breakdown last 6 months
    months = {}
    for p in payments:
        k = (p.get("date") or "")[:7]
        months.setdefault(k, {"collection": 0, "expense": 0})
        months[k]["collection"] += p.get("amount", 0)
    for e in expenses:
        k = (e.get("date") or "")[:7]
        months.setdefault(k, {"collection": 0, "expense": 0})
        months[k]["expense"] += e.get("amount", 0)
    monthly = [{"month": k, **v, "profit": v["collection"] - v["expense"]} for k, v in sorted(months.items())][-6:]
    # expense by category
    by_cat = {}
    for e in expenses:
        by_cat[e["category"]] = by_cat.get(e["category"], 0) + e.get("amount", 0)
    return {
        "has_hostel": True,
        "total_collection": round(total_collection, 2),
        "total_expenses": round(total_expenses, 2),
        "net_profit": round(total_collection - total_expenses, 2),
        "occupancy_pct": round((occupied / total_beds * 100), 0) if total_beds else 0,
        "available_beds": total_beds - occupied,
        "total_beds": total_beds,
        "rent_due_count": len([t for t in tenants if t.get("payment_status") == "due"]),
        "rent_due_amount": sum(t.get("monthly_rent", 0) for t in tenants if t.get("payment_status") == "due"),
        "monthly": monthly,
        "expense_by_category": by_cat,
    }


# Notices & Complaints (owner)
class NoticeBody(BaseModel):
    hostel_id: Optional[str] = None
    title: str
    body: str


@api.get("/owner/notices")
async def owner_notices(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"notices": []}
    notices = await db.notices.find({"hostel_id": h["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"notices": notices}


@api.post("/owner/notices")
async def owner_add_notice(body: NoticeBody, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, body.hostel_id)
    if not h:
        raise HTTPException(400, "Create your hostel first")
    doc = {"id": new_id(), "hostel_id": h["id"], "title": body.title, "body": body.body,
           "created_at": now_utc().isoformat()}
    await db.notices.insert_one(doc)
    return {"notice": clean(doc)}


@api.get("/owner/complaints")
async def owner_complaints(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"complaints": [], "requests": []}
    complaints = await db.complaints.find({"hostel_id": h["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    requests = await db.requests.find({"hostel_id": h["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"complaints": complaints, "requests": requests}


@api.post("/owner/complaints/{complaint_id}/resolve")
async def owner_resolve_complaint(complaint_id: str, user: dict = Depends(require_roles("owner"))):
    c = await db.complaints.find_one({"id": complaint_id})
    if c and await hostel_owned(user, c["hostel_id"]):
        await db.complaints.update_one({"id": complaint_id},
                                       {"$set": {"status": "resolved", "resolved_at": now_utc().isoformat()}})
    return {"ok": True}


@api.post("/owner/requests/{request_id}/resolve")
async def owner_resolve_request(request_id: str, user: dict = Depends(require_roles("owner"))):
    r = await db.requests.find_one({"id": request_id})
    if r and await hostel_owned(user, r["hostel_id"]):
        await db.requests.update_one({"id": request_id}, {"$set": {"status": "resolved"}})
    return {"ok": True}


@api.get("/owner/enquiries")
async def owner_enquiries(user: dict = Depends(require_roles("owner"))):
    enquiries = await db.enquiries.find({"owner_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"enquiries": enquiries}


# ---------------- Tenant routes ----------------
async def _tenant_record(user: dict) -> Optional[dict]:
    t = await db.tenants.find_one({"user_id": user["id"], "active": True}, {"_id": 0})
    if not t:
        t = await db.tenants.find_one({"email": user.get("email"), "active": True}, {"_id": 0})
    return t


@api.get("/tenant/home")
async def tenant_home(user: dict = Depends(require_roles("tenant"))):
    t = await _tenant_record(user)
    if not t:
        return {"has_allocation": False}
    hostel = await db.hostels.find_one({"id": t["hostel_id"]}, {"_id": 0})
    return {"has_allocation": True, "tenant": t, "hostel": hostel}


@api.get("/tenant/payments")
async def tenant_payments(user: dict = Depends(require_roles("tenant"))):
    t = await _tenant_record(user)
    if not t:
        return {"payments": []}
    payments = await db.payments.find({"tenant_id": t["id"]}, {"_id": 0}).sort("date", -1).to_list(1000)
    return {"payments": payments}


@api.get("/tenant/notices")
async def tenant_notices(user: dict = Depends(require_roles("tenant"))):
    t = await _tenant_record(user)
    if not t:
        return {"notices": []}
    notices = await db.notices.find({"hostel_id": t["hostel_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"notices": notices}


class ComplaintBody(BaseModel):
    title: str
    body: str


@api.get("/tenant/complaints")
async def tenant_get_complaints(user: dict = Depends(require_roles("tenant"))):
    t = await _tenant_record(user)
    if not t:
        return {"complaints": [], "requests": []}
    complaints = await db.complaints.find({"tenant_id": t["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    requests = await db.requests.find({"tenant_id": t["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"complaints": complaints, "requests": requests}


@api.post("/tenant/complaints")
async def tenant_add_complaint(body: ComplaintBody, user: dict = Depends(require_roles("tenant"))):
    t = await _tenant_record(user)
    if not t:
        raise HTTPException(400, "No active allocation")
    doc = {"id": new_id(), "hostel_id": t["hostel_id"], "tenant_id": t["id"], "tenant_name": t["name"],
           "title": body.title, "body": body.body, "status": "open", "created_at": now_utc().isoformat()}
    await db.complaints.insert_one(doc)
    return {"complaint": clean(doc)}


class RequestBody(BaseModel):
    type: Literal["room_change", "checkout"]
    note: Optional[str] = None


@api.post("/tenant/requests")
async def tenant_add_request(body: RequestBody, user: dict = Depends(require_roles("tenant"))):
    t = await _tenant_record(user)
    if not t:
        raise HTTPException(400, "No active allocation")
    doc = {"id": new_id(), "hostel_id": t["hostel_id"], "tenant_id": t["id"], "tenant_name": t["name"],
           "type": body.type, "note": body.note, "status": "pending", "created_at": now_utc().isoformat()}
    await db.requests.insert_one(doc)
    return {"request": clean(doc)}


# ---------------- Subscription (bed-slab pricing + trial + Razorpay) ----------------
def _parse_dt(s):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


async def bed_count_for_hostel(hostel_id: str) -> int:
    rooms = await db.rooms.find({"hostel_id": hostel_id}, {"_id": 0, "beds": 1}).to_list(2000)
    return sum(len(r.get("beds", [])) for r in rooms)


def compute_sub_status(hostel: dict) -> dict:
    now = now_utc()
    expiry = _parse_dt(hostel.get("plan_expiry"))
    trial = _parse_dt(hostel.get("trial_ends_at"))
    if expiry and expiry > now:
        return {"status": "active", "plan": hostel.get("premium_plan"),
                "expires_at": hostel.get("plan_expiry"),
                "days_left": (expiry - now).days, "is_premium": True}
    if trial and trial > now:
        return {"status": "trial", "plan": "Free Trial",
                "expires_at": hostel.get("trial_ends_at"),
                "days_left": (trial - now).days, "is_premium": True}
    return {"status": "expired", "plan": None,
            "expires_at": hostel.get("plan_expiry") or hostel.get("trial_ends_at"),
            "days_left": 0, "is_premium": False}


@api.get("/owner/subscription")
async def owner_subscription(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        raise HTTPException(400, "Create your hostel first")
    beds = await bed_count_for_hostel(h["id"])
    slab = slab_for_beds(beds)
    return {
        "hostel_id": h["id"],
        "hostel_name": h["name"],
        "bed_count": beds,
        "slab_label": slab["label"],
        "prices": slab["prices"],
        "payments_enabled": _rzp_ready(),
        "subscription": compute_sub_status(h),
        "history": await db.subscriptions.find({"hostel_id": h["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50),
    }


async def _activate_subscription(hostel: dict, months: int, amount: float, method: str, owner_id: str):
    now = now_utc()
    current_expiry = _parse_dt(hostel.get("plan_expiry"))
    base = current_expiry if (current_expiry and current_expiry > now) else now
    end = add_months(base, months)
    plan_name = {1: "Monthly", 3: "3-Month", 6: "6-Month", 12: "12-Month"}.get(months, f"{months}-Month") + " Plan"
    await db.subscriptions.insert_one({
        "id": new_id(), "owner_id": owner_id, "hostel_id": hostel["id"],
        "plan_name": plan_name, "months": months, "amount": amount, "method": method,
        "status": "active", "start": now.isoformat(), "end": end.isoformat(),
        "created_at": now.isoformat(),
    })
    await db.hostels.update_one({"id": hostel["id"]}, {"$set": {
        "premium_plan": plan_name, "plan_expiry": end.isoformat()}})
    return end.isoformat()


class SubLinkBody(BaseModel):
    hostel_id: str
    months: Literal[1, 3, 6, 12]


@api.post("/payments/subscription/link")
async def create_sub_link(body: SubLinkBody, user: dict = Depends(require_roles("owner"))):
    h = await hostel_owned(user, body.hostel_id)
    if not h:
        raise HTTPException(404, "Hostel not found")
    if not _rzp_ready():
        raise HTTPException(400, "Online payments are not configured yet. Please try manual activation via admin, or add a Razorpay key.")
    beds = await bed_count_for_hostel(h["id"])
    slab = slab_for_beds(beds)
    rupees = slab["prices"][body.months]
    amount_paise = int(rupees * 100)
    import razorpay as _rzp
    rpc = _rzp.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    reference = f"sub_{h['id']}_{int(now_utc().timestamp()*1000)}"
    link = rpc.payment_link.create({
        "amount": amount_paise, "currency": "INR", "accept_partial": False,
        "reference_id": reference,
        "description": f"Hostel 360 - {slab['label']} - {body.months} month(s)",
        "customer": {"name": user.get("name") or "Owner", "contact": user.get("mobile") or "", "email": user.get("email") or ""},
        "notify": {"sms": False, "email": False}, "reminder_enable": False,
        "callback_url": f"{BACKEND_URL}/api/razorpay/callback", "callback_method": "get",
    })
    await db.rp_payments.insert_one({
        "id": new_id(), "payment_link_id": link["id"], "reference_id": reference,
        "hostel_id": h["id"], "owner_id": user["id"], "months": body.months,
        "amount": rupees, "amount_paise": amount_paise, "status": "created",
        "activated": False, "created_at": now_utc().isoformat(),
    })
    return {"payment_link_id": link["id"], "checkout_url": link["short_url"], "amount": rupees}


@api.get("/payments/subscription/status/{payment_link_id}")
async def sub_status(payment_link_id: str, user: dict = Depends(require_roles("owner"))):
    rec = await db.rp_payments.find_one({"payment_link_id": payment_link_id, "owner_id": user["id"]}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Payment not found")
    if rec.get("activated"):
        return {"status": "paid", "activated": True, "months": rec["months"]}
    if _rzp_ready():
        import razorpay as _rzp
        rpc = _rzp.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
        remote = rpc.payment_link.fetch(payment_link_id)
        if remote.get("status") == "paid":
            h = await db.hostels.find_one({"id": rec["hostel_id"]}, {"_id": 0})
            await _activate_subscription(h, rec["months"], rec["amount"], "razorpay", rec["owner_id"])
            await db.rp_payments.update_one({"payment_link_id": payment_link_id},
                                            {"$set": {"status": "paid", "activated": True, "paid_at": now_utc().isoformat()}})
            return {"status": "paid", "activated": True, "months": rec["months"]}
        return {"status": remote.get("status", "pending"), "activated": False}
    return {"status": rec.get("status", "pending"), "activated": False}


@api.get("/razorpay/callback")
async def razorpay_callback(status: str = "paid"):
    from fastapi.responses import HTMLResponse
    return HTMLResponse("<html><body style='font-family:sans-serif;text-align:center;padding-top:80px'>"
                        "<h2>Payment received 🎉</h2><p>You can return to the Hostel 360 app.</p></body></html>")


@api.post("/razorpay/webhook")
async def razorpay_webhook(request: Request):
    import hmac, hashlib, json as _json
    raw = await request.body()
    sig = request.headers.get("X-Razorpay-Signature", "")
    if RAZORPAY_WEBHOOK_SECRET:
        expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(400, "Invalid webhook signature")
    try:
        event = _json.loads(raw)
    except Exception:
        raise HTTPException(400, "Bad payload")
    if event.get("event") in ("payment_link.paid",):
        entity = event.get("payload", {}).get("payment_link", {}).get("entity", {})
        link_id = entity.get("id")
        rec = await db.rp_payments.find_one({"payment_link_id": link_id})
        if rec and not rec.get("activated"):
            h = await db.hostels.find_one({"id": rec["hostel_id"]}, {"_id": 0})
            if h:
                await _activate_subscription(h, rec["months"], rec["amount"], "razorpay", rec["owner_id"])
                await db.rp_payments.update_one({"payment_link_id": link_id},
                                                {"$set": {"status": "paid", "activated": True}})
    return {"ok": True}


class ManualActivateBody(BaseModel):
    months: Literal[1, 3, 6, 12]
    note: Optional[str] = None


@api.post("/admin/hostels/{hostel_id}/activate-plan")
async def admin_activate_plan(hostel_id: str, body: ManualActivateBody, user: dict = Depends(require_roles("admin"))):
    h = await db.hostels.find_one({"id": hostel_id}, {"_id": 0})
    if not h:
        raise HTTPException(404, "Hostel not found")
    beds = await bed_count_for_hostel(hostel_id)
    slab = slab_for_beds(beds)
    amount = slab["prices"][body.months]
    end = await _activate_subscription(h, body.months, amount, "manual", h["owner_id"])
    return {"ok": True, "expires_at": end, "amount": amount, "plan_months": body.months}


# ---------------- Payments (Stripe) ----------------
class SubCheckoutBody(BaseModel):
    plan_id: str
    hostel_id: Optional[str] = None


class RentCheckoutBody(BaseModel):
    pass


def _stripe_ready() -> bool:
    return bool(STRIPE_API_KEY and STRIPE_API_KEY.startswith("sk_"))


async def _create_checkout(amount_cents: int, meta: dict, product_name: str) -> dict:
    import stripe
    stripe.api_key = STRIPE_API_KEY
    origin = BACKEND_URL or "https://example.com"
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[{
            "price_data": {
                "currency": "usd",
                "product_data": {"name": product_name},
                "unit_amount": amount_cents,
            },
            "quantity": 1,
        }],
        success_url=f"{origin}/api/payments/return?status=success&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/api/payments/return?status=cancel",
        metadata=meta,
    )
    await db.stripe_transactions.insert_one({
        "id": new_id(),
        "session_id": session.id,
        "amount": amount_cents / 100,
        "currency": "usd",
        "metadata": meta,
        "payment_status": "initiated",
        "created_at": now_utc().isoformat(),
    })
    return {"url": session.url, "session_id": session.id}


@api.post("/payments/subscription/checkout")
async def sub_checkout(body: SubCheckoutBody, user: dict = Depends(require_roles("owner"))):
    if not _stripe_ready():
        raise HTTPException(400, "Payments are not configured yet. Add a Stripe key to enable online payments.")
    plan = await db.plans.find_one({"id": body.plan_id, "active": True}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plan not available")
    h = await get_owner_hostel(user, body.hostel_id)
    if not h:
        raise HTTPException(400, "Create your hostel first")
    meta = {"kind": "subscription", "plan_id": plan["id"], "owner_id": user["id"],
            "hostel_id": h["id"], "months": str(plan["duration_months"])}
    return await _create_checkout(int(plan["price"] * 100), meta, f"Hostel 360 - {plan['name']}")


@api.post("/payments/rent/checkout")
async def rent_checkout(body: RentCheckoutBody, user: dict = Depends(require_roles("tenant"))):
    if not _stripe_ready():
        raise HTTPException(400, "Payments are not configured yet. Add a Stripe key to enable online payments.")
    t = await _tenant_record(user)
    if not t:
        raise HTTPException(400, "No active allocation")
    meta = {"kind": "rent", "tenant_id": t["id"], "hostel_id": t["hostel_id"]}
    return await _create_checkout(int(t["monthly_rent"] * 100), meta, f"Rent - {t['name']} ({t['room_number']})")


async def _fulfill(session_id: str, meta: dict, amount: float):
    kind = meta.get("kind")
    if kind == "subscription":
        plan = await db.plans.find_one({"id": meta["plan_id"]}, {"_id": 0})
        months = int(meta.get("months", 1))
        end = now_utc() + timedelta(days=30 * months)
        await db.subscriptions.insert_one({
            "id": new_id(), "owner_id": meta["owner_id"], "hostel_id": meta["hostel_id"],
            "plan_id": meta["plan_id"], "plan_name": plan["name"] if plan else "Plan",
            "amount": amount, "status": "active", "start": now_utc().isoformat(),
            "end": end.isoformat(), "created_at": now_utc().isoformat(),
        })
        await db.hostels.update_one({"id": meta["hostel_id"]}, {"$set": {
            "premium_plan": plan["name"] if plan else "Premium", "plan_expiry": end.isoformat()}})
    elif kind == "rent":
        t = await db.tenants.find_one({"id": meta["tenant_id"]}, {"_id": 0})
        if t:
            await db.payments.insert_one({
                "id": new_id(), "hostel_id": meta["hostel_id"], "tenant_id": meta["tenant_id"],
                "tenant_name": t["name"], "amount": amount, "type": "rent", "method": "online",
                "receipt_no": _receipt_no(), "status": "paid", "date": now_utc().isoformat(),
                "created_at": now_utc().isoformat()})
            await db.tenants.update_one({"id": meta["tenant_id"]}, {"$set": {"payment_status": "paid", "last_paid": now_utc().isoformat()}})


@api.get("/payments/status/{session_id}")
async def payment_status(session_id: str, user: dict = Depends(get_current_user)):
    if not _stripe_ready():
        raise HTTPException(400, "Payments not configured")
    import stripe
    stripe.api_key = STRIPE_API_KEY
    session = stripe.checkout.Session.retrieve(session_id)
    tx = await db.stripe_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if tx and tx.get("payment_status") != "paid" and session.payment_status == "paid":
        await db.stripe_transactions.update_one({"session_id": session_id}, {"$set": {"payment_status": "paid"}})
        await _fulfill(session_id, tx["metadata"], tx["amount"])
    return {"payment_status": session.payment_status, "status": session.status}


@api.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    if not _stripe_ready():
        return {"received": True}
    import stripe
    stripe.api_key = STRIPE_API_KEY
    payload = await request.body()
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    try:
        if webhook_secret:
            event = stripe.Webhook.construct_event(payload, request.headers.get("stripe-signature"), webhook_secret)
        else:
            import json
            event = json.loads(payload)
    except Exception:
        raise HTTPException(400, "Invalid webhook")
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        tx = await db.stripe_transactions.find_one({"session_id": session["id"]}, {"_id": 0})
        if tx and tx.get("payment_status") != "paid":
            await db.stripe_transactions.update_one({"session_id": session["id"]}, {"$set": {"payment_status": "paid"}})
            await _fulfill(session["id"], tx["metadata"], tx["amount"])
    return {"received": True}


@api.get("/payments/return")
async def payments_return(status: str = "success"):
    from fastapi.responses import HTMLResponse
    msg = "Payment successful! You can return to the app." if status == "success" else "Payment cancelled."
    return HTMLResponse(f"<html><body style='font-family:sans-serif;text-align:center;padding-top:80px'><h2>{msg}</h2></body></html>")


@api.get("/")
async def root():
    return {"message": "Hostel 360 API", "status": "ok"}


# ---------------- Startup ----------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    # seed admin
    existing = await db.users.find_one({"email": ADMIN_EMAIL.lower()})
    if not existing:
        await db.users.insert_one({
            "id": new_id(), "email": ADMIN_EMAIL.lower(), "password_hash": hash_pw(ADMIN_PASSWORD),
            "name": "Platform Admin", "mobile": None, "role": "admin", "auth_provider": "password",
            "blocked": False, "active": True, "hostel_id": None, "created_at": now_utc().isoformat()})
        logger.info("Seeded admin account %s", ADMIN_EMAIL)
    # seed default plans
    if await db.plans.count_documents({}) == 0:
        defaults = [
            {"name": "Monthly Plan", "duration_months": 1, "price": 19.99, "features": ["Listed publicly", "Verified badge", "Unlimited rooms & tenants"]},
            {"name": "3-Month Plan", "duration_months": 3, "price": 54.99, "features": ["All Monthly features", "Priority support", "Save 8%"]},
            {"name": "6-Month Plan", "duration_months": 6, "price": 99.99, "features": ["All features", "Featured placement", "Save 16%"]},
            {"name": "12-Month Plan", "duration_months": 12, "price": 179.99, "features": ["All features", "Top featured", "Save 25%"]},
        ]
        for p in defaults:
            await db.plans.insert_one({"id": new_id(), **p, "active": True, "created_at": now_utc().isoformat()})
        logger.info("Seeded default subscription plans")

    # seed demo owner + hostels + tenant for an instant end-to-end demo
    if await db.hostels.count_documents({}) == 0:
        await _seed_demo()

    # backfill 45-day trial for hostels missing trial_ends_at
    async for h in db.hostels.find({"trial_ends_at": {"$exists": False}}, {"_id": 0, "id": 1, "created_at": 1}):
        base = _parse_dt(h.get("created_at")) or now_utc()
        await db.hostels.update_one({"id": h["id"]},
                                    {"$set": {"trial_ends_at": (base + timedelta(days=TRIAL_DAYS)).isoformat()}})


IMG = {
    "coliving": "https://images.unsplash.com/photo-1772471586681-8dba94c41ff7?crop=entropy&cs=srgb&fm=jpg&q=80&w=1200",
    "bunk": "https://images.unsplash.com/photo-1709805619372-40de3f158e83?crop=entropy&cs=srgb&fm=jpg&q=80&w=1200",
    "room1": "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?crop=entropy&cs=srgb&fm=jpg&q=80&w=1200",
    "room2": "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?crop=entropy&cs=srgb&fm=jpg&q=80&w=1200",
    "room3": "https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?crop=entropy&cs=srgb&fm=jpg&q=80&w=1200",
}


async def _seed_demo():
    owner = {
        "id": new_id(), "email": "owner@hostel360.com", "password_hash": hash_pw("Owner@12345"),
        "name": "Rahul Sharma", "mobile": "9876500011", "role": "owner", "auth_provider": "password",
        "blocked": False, "active": True, "hostel_id": None, "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(owner)

    main_hostel = {
        "id": new_id(), "owner_id": owner["id"], "name": "Green Nest Co-Living", "pg_name": "Green Nest PG",
        "owner_name": "Rahul Sharma", "mobile": "9876500011",
        "address": "12, MG Road, Near Metro Station", "city": "Bengaluru", "state": "Karnataka",
        "area": "Indiranagar", "google_location": "12.9719,77.6412", "gender": "co-living",
        "photos": [IMG["coliving"], IMG["room1"], IMG["room2"]],
        "amenities": ["Wi-Fi", "Food", "Parking", "Laundry", "CCTV", "AC"],
        "sharing_types": ["single", "double", "triple"], "ownership_proof": None,
        "status": "approved", "verification_status": "verified", "site_visit_status": "verified",
        "identity_verified": True, "premium_plan": "6-Month Plan",
        "plan_expiry": (now_utc() + timedelta(days=150)).isoformat(),
        "rating": 4.6, "reviews_count": 2, "min_rent": 6500, "created_at": now_utc().isoformat(),
    }
    await db.hostels.insert_one(main_hostel)
    await db.users.update_one({"id": owner["id"]}, {"$set": {"hostel_id": main_hostel["id"]}})

    rooms = []
    room_specs = [
        ("1", "101", "single", 9500, 1), ("1", "102", "double", 7000, 2),
        ("2", "201", "double", 6500, 2), ("2", "202", "triple", 5500, 3),
    ]
    for floor, rno, rtype, rent, bc in room_specs:
        beds = [{"bed_number": f"{rno}-{i+1}", "status": "available", "tenant_id": None} for i in range(bc)]
        room = {"id": new_id(), "hostel_id": main_hostel["id"], "floor": floor, "room_number": rno,
                "room_type": rtype, "rent": rent, "beds": beds, "created_at": now_utc().isoformat()}
        rooms.append(room)
        await db.rooms.insert_one(room)

    # demo tenant with login
    t_room = rooms[1]
    tenant_user = {
        "id": new_id(), "email": "tenant@hostel360.com", "password_hash": hash_pw("Tenant@12345"),
        "name": "Amit Verma", "mobile": "9876500022", "role": "tenant", "auth_provider": "password",
        "blocked": False, "active": True, "hostel_id": main_hostel["id"], "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(tenant_user)
    tenant = {
        "id": new_id(), "hostel_id": main_hostel["id"], "user_id": tenant_user["id"],
        "tenant_code": "T" + new_id()[:6].upper(), "name": "Amit Verma", "mobile": "9876500022",
        "email": "tenant@hostel360.com", "room_id": t_room["id"], "room_number": t_room["room_number"],
        "bed_number": t_room["beds"][0]["bed_number"], "joining_date": (now_utc() - timedelta(days=40)).isoformat(),
        "monthly_rent": 7000, "security_deposit": 14000, "advance_amount": 7000, "payment_status": "due",
        "active": True, "created_at": now_utc().isoformat(),
    }
    await db.tenants.insert_one(tenant)
    await db.users.update_one({"id": tenant_user["id"]}, {"$set": {"tenant_id": tenant["id"]}})
    await db.rooms.update_one({"id": t_room["id"], "beds.bed_number": tenant["bed_number"]},
                              {"$set": {"beds.$.status": "occupied", "beds.$.tenant_id": tenant["id"]}})
    # a paid payment history entry
    await db.payments.insert_one({
        "id": new_id(), "hostel_id": main_hostel["id"], "tenant_id": tenant["id"], "tenant_name": "Amit Verma",
        "amount": 7000, "type": "rent", "method": "cash", "receipt_no": _receipt_no(), "status": "paid",
        "date": (now_utc() - timedelta(days=10)).isoformat(), "created_at": now_utc().isoformat()})
    await db.expenses.insert_one({
        "id": new_id(), "hostel_id": main_hostel["id"], "category": "electricity", "amount": 3200,
        "note": "Monthly bill", "date": now_utc().isoformat(), "created_at": now_utc().isoformat()})
    await db.notices.insert_one({
        "id": new_id(), "hostel_id": main_hostel["id"], "title": "Water tank cleaning",
        "body": "Water supply will be off on Sunday 9am-12pm for tank cleaning.", "created_at": now_utc().isoformat()})
    await db.reviews.insert_many([
        {"id": new_id(), "hostel_id": main_hostel["id"], "rating": 5, "comment": "Clean rooms and great food!", "name": "Priya", "created_at": now_utc().isoformat()},
        {"id": new_id(), "hostel_id": main_hostel["id"], "rating": 4, "comment": "Good location, friendly staff.", "name": "Karan", "created_at": now_utc().isoformat()},
    ])

    # additional approved hostels for public search
    extras = [
        {"name": "Sunrise Boys Hostel", "city": "Bengaluru", "area": "Koramangala", "gender": "boys",
         "min_rent": 5000, "rating": 4.2, "photos": [IMG["bunk"], IMG["room3"]], "sharing": ["double", "triple"]},
        {"name": "Lotus Girls PG", "city": "Pune", "area": "Kothrud", "gender": "girls",
         "min_rent": 7500, "rating": 4.8, "photos": [IMG["room2"], IMG["room1"]], "sharing": ["single", "double"]},
        {"name": "Metro Stay PG", "city": "Hyderabad", "area": "Gachibowli", "gender": "pg",
         "min_rent": 6000, "rating": 4.0, "photos": [IMG["room3"], IMG["coliving"]], "sharing": ["double", "triple"]},
    ]
    for e in extras:
        await db.hostels.insert_one({
            "id": new_id(), "owner_id": owner["id"], "name": e["name"], "pg_name": e["name"],
            "owner_name": "Rahul Sharma", "mobile": "9876500011",
            "address": f"{e['area']}, {e['city']}", "city": e["city"], "state": "India",
            "area": e["area"], "google_location": None, "gender": e["gender"], "photos": e["photos"],
            "amenities": ["Wi-Fi", "Food", "Laundry", "CCTV"], "sharing_types": e["sharing"],
            "ownership_proof": None, "status": "approved", "verification_status": "verified",
            "site_visit_status": "verified", "identity_verified": True, "premium_plan": "Monthly Plan",
            "plan_expiry": (now_utc() + timedelta(days=25)).isoformat(),
            "rating": e["rating"], "reviews_count": 0, "min_rent": e["min_rent"], "created_at": now_utc().isoformat(),
        })
    # a pending hostel awaiting admin verification
    await db.hostels.insert_one({
        "id": new_id(), "owner_id": owner["id"], "name": "Urban Roost PG", "pg_name": "Urban Roost",
        "owner_name": "Rahul Sharma", "mobile": "9876500011", "address": "5th Cross, Jayanagar",
        "city": "Bengaluru", "state": "Karnataka", "area": "Jayanagar", "google_location": "12.92,77.58",
        "gender": "pg", "photos": [IMG["room1"]], "amenities": ["Wi-Fi", "Food"], "sharing_types": ["double"],
        "ownership_proof": None, "status": "pending", "verification_status": "pending",
        "site_visit_status": "not_verified", "identity_verified": False, "premium_plan": None,
        "plan_expiry": None, "rating": 0, "reviews_count": 0, "min_rent": 6000, "created_at": now_utc().isoformat(),
    })
    logger.info("Seeded demo hostels, owner, and tenant")


@app.on_event("shutdown")
async def shutdown():
    client.close()


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
