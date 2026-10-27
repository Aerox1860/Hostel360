import os
import re
import asyncio
import uuid
import logging
import hashlib
import hmac
import random
import secrets
import base64
import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from datetime import date, datetime, timedelta, timezone, time
from typing import List, Optional, Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from io import BytesIO

import bcrypt
import jwt
import httpx
from PIL import Image, ImageEnhance, ImageFilter, ImageOps, UnidentifiedImageError
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, status, Header, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, StrictBool, field_validator, model_validator
from pymongo.errors import DuplicateKeyError, PyMongoError
from cryptography.fernet import Fernet, InvalidToken
from google.auth import exceptions as google_auth_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("hostel360")

APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]

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
AD_MEDIA_DIR = ROOT_DIR / "uploads" / "advertisements"
TENANT_DOCUMENT_DIR = ROOT_DIR / "uploads" / "tenant-documents"
TENANT_DOCUMENT_MAX_SIZE = 10 * 1024 * 1024
TENANT_DOCUMENT_ENCRYPTION_KEY = os.environ.get("TENANT_DOCUMENT_ENCRYPTION_KEY", "")
TENANT_AADHAAR_HMAC_KEY = os.environ.get("TENANT_AADHAAR_HMAC_KEY", "")
TENANT_REPORT_EVIDENCE_DIR = ROOT_DIR / "uploads" / "tenant-report-evidence"
TENANT_REPORT_EVIDENCE_MAX_SIZE = 10 * 1024 * 1024
TENANT_RENT_EVIDENCE_DIR = ROOT_DIR / "uploads" / "tenant-rent-evidence"
TENANT_RENT_EVIDENCE_MAX_SIZE = 3 * 1024 * 1024
RULE_IMAGE_DIR = ROOT_DIR / "uploads" / "rules-images"
RULE_IMAGE_MAX_SIZE = 10 * 1024 * 1024
RULE_IMAGES_MAX_TOTAL_SIZE = 20 * 1024 * 1024
RULE_IMAGES_MAX_COUNT = 5
RULE_IMAGE_MAX_PIXELS = 40_000_000
RULES_OCR_API_KEY = os.environ.get("GOOGLE_GENAI_API_KEY", "")
RULES_OCR_MODEL = os.environ.get("RULES_OCR_MODEL", "gemini-2.5-flash")
AD_IMAGE_LIMIT = 20 * 1024 * 1024
AD_VIDEO_LIMIT = 100 * 1024 * 1024
AD_STATUS_REFRESH_TASK = None
AD_DEFAULT_SETTINGS = {
    "ads_enabled": True,
    "free_cooldown_minutes": 30,
    "premium_cooldown_minutes": 30,
}
AD_PREVIOUS_DEFAULT_SETTINGS = {
    "free_cooldown_minutes": 60,
    "premium_cooldown_minutes": 180,
}
AD_LEGACY_DEFAULT_SETTINGS = {
    "free_cooldown_minutes": 30,
    "premium_cooldown_minutes": 120,
}
AD_RESERVATION_SECONDS = 300
TENANT_INITIAL_PASSWORD = "Tenant@12345"
GOOGLE_OAUTH_CLIENT_IDS = tuple(
    client_id.strip()
    for client_id in os.environ.get("GOOGLE_OAUTH_CLIENT_IDS", "").split(",")
    if client_id.strip()
)

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


def _validate_production_config():
    if APP_ENV not in {"development", "test", "staging", "production"}:
        raise RuntimeError("APP_ENV must be development, test, staging, or production.")
    if APP_ENV != "production":
        return
    if (
        JWT_SECRET == "hostel360-dev-secret"
        or len(JWT_SECRET.encode("utf-8")) < 32
        or "change-this" in JWT_SECRET.casefold()
        or "your-super-secret" in JWT_SECRET.casefold()
    ):
        raise RuntimeError("Production requires a unique JWT_SECRET of at least 32 bytes.")
    if (
        ADMIN_PASSWORD == "Admin@12345"
        or len(ADMIN_PASSWORD) < 12
        or "replace-with" in ADMIN_PASSWORD.casefold()
    ):
        raise RuntimeError("Production requires a non-default ADMIN_PASSWORD of at least 12 characters.")
    if len(TENANT_AADHAAR_HMAC_KEY.encode("utf-8")) < 32:
        raise RuntimeError("Production requires the stable TENANT_AADHAAR_HMAC_KEY of at least 32 bytes.")
    try:
        Fernet(TENANT_DOCUMENT_ENCRYPTION_KEY.encode("ascii"))
    except (UnicodeEncodeError, ValueError):
        raise RuntimeError("Production requires a valid TENANT_DOCUMENT_ENCRYPTION_KEY.")
    cors_origins = [urlsplit(origin) for origin in CORS_ALLOWED_ORIGINS]
    if not cors_origins or any(
        origin.scheme != "https"
        or not origin.netloc
        or origin.path
        or origin.query
        or origin.fragment
        for origin in cors_origins
    ) or any("*" in origin for origin in CORS_ALLOWED_ORIGINS):
        raise RuntimeError("Production CORS_ALLOWED_ORIGINS must contain only explicit HTTPS origins.")


def _validate_existing_admin(existing_admin: Optional[dict]):
    if (
        APP_ENV == "production"
        and existing_admin
        and verify_pw("Admin@12345", existing_admin.get("password_hash"))
    ):
        raise RuntimeError("Change the existing default admin password before production startup.")


@app.get("/healthz", include_in_schema=False)
async def health_check():
    return {"status": "ok"}


@app.get("/readyz", include_in_schema=False)
async def readiness_check():
    try:
        await db.command("ping")
    except PyMongoError as exc:
        logger.warning("MongoDB readiness check failed (%s)", type(exc).__name__)
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    return {"status": "ready"}


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    sanitized_errors = []
    for error in exc.errors():
        safe_error = dict(error)
        if any(
            str(part).casefold().endswith(("password", "token", "aadhaar_number"))
            for part in error.get("loc", ())
        ):
            safe_error.pop("input", None)
        sanitized_errors.append(safe_error)
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(sanitized_errors)})


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


def hash_pw(pw: str) -> str:
    encoded = pw.encode()
    if len(encoded) > 72:
        raise ValueError("Password must be no more than 72 UTF-8 bytes")
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=12)).decode()


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


def _normalized_room_key(hostel_id: str, floor: str, room_number: str) -> dict:
    return {
        "hostel_id": str(hostel_id or ""),
        "floor_key": str(floor if floor is not None else "").strip().casefold(),
        "room_key": str(room_number if room_number is not None else "").strip().casefold(),
    }


def _room_bed_counts(rooms: list[dict]) -> dict:
    beds = [bed for room in rooms for bed in (room.get("beds") or [])]
    occupied = sum(1 for bed in beds if bed.get("status") == "occupied")
    available = sum(1 for bed in beds if bed.get("status") == "available")
    return {"total": len(beds), "occupied": occupied, "available": available}


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
        "must_change_password": bool(
            u.get("role") == "tenant" and u.get("must_change_password", False)
        ),
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
    allowed_password_change_paths = {
        "/api/auth/me",
        "/api/auth/password/change",
    }
    if (
        user.get("role") == "tenant"
        and user.get("must_change_password", False)
        and request.url.path.rstrip("/") not in allowed_password_change_paths
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "password_change_required",
                "message": "Change your temporary password before continuing",
            },
        )
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

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _validate_password(value)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class TenantPasswordChangeBody(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return _validate_password(value)


class SessionBody(BaseModel):
    session_id: str


class GoogleTokenBody(BaseModel):
    id_token: str = Field(min_length=1, max_length=8192)


def _validate_password(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters")
    if len(value.encode()) > 72:
        raise ValueError("Password must be no more than 72 UTF-8 bytes")
    return value


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
    if user.get("role") == "tenant" and body.password == TENANT_INITIAL_PASSWORD:
        if not user.get("must_change_password", False):
            await db.users.update_one(
                {"id": user["id"]},
                {"$set": {"must_change_password": True}},
            )
            user["must_change_password"] = True
    return {"access_token": make_token(user), "user": public_user(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": public_user(user)}


@api.post("/auth/password/change")
async def change_tenant_password(
    body: TenantPasswordChangeBody,
    user: dict = Depends(get_current_user),
):
    if user.get("role") != "tenant":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only tenant accounts use this password-change flow")
    if not user.get("must_change_password", False):
        raise HTTPException(status.HTTP_409_CONFLICT, "A mandatory password change is not pending")
    if not verify_pw(body.current_password, user.get("password_hash")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if body.current_password == body.new_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a different password")

    result = await db.users.update_one(
        {"id": user["id"], "must_change_password": True},
        {"$set": {
            "password_hash": hash_pw(body.new_password),
            "must_change_password": False,
            "password_changed_at": now_utc().isoformat(),
        }},
    )
    if result.matched_count != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Password-change state has already changed; sign in again")

    updated_user = {**user, "must_change_password": False}
    return {"ok": True, "user": public_user(updated_user)}


def verify_google_identity(token: str) -> dict:
    if not GOOGLE_OAUTH_CLIENT_IDS:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Direct Google Sign-In is not configured on the server",
        )
    try:
        claims = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            audience=None,
        )
    except ValueError as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Google ID token") from error
    except google_auth_exceptions.GoogleAuthError as error:
        logger.error("Google ID token verification service is unavailable: %s", type(error).__name__)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Google identity verification is temporarily unavailable",
        ) from error

    audience = claims.get("aud")
    if (
        claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
        or not isinstance(audience, str)
        or audience not in GOOGLE_OAUTH_CLIENT_IDS
        or not isinstance(claims.get("sub"), str)
        or not claims.get("sub")
        or not isinstance(claims.get("email"), str)
        or not claims.get("email")
        or claims.get("email_verified") is not True
        or (
            claims.get("azp") is not None
            and claims.get("azp") not in GOOGLE_OAUTH_CLIENT_IDS
        )
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Google ID token")
    return claims


def _google_account_conflict(message: str, code: str = "google_link_required"):
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        detail={"code": code, "message": message},
    )


async def _resolve_google_user(claims: dict, *, allow_create: bool) -> dict:
    subject = claims["sub"]
    email = claims["email"].strip().lower()
    user = await db.users.find_one({"google_sub": subject}, {"_id": 0})
    if user:
        if user.get("blocked"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account has been blocked. Contact admin.")
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"google_identity_verified_at": now_utc().isoformat()}},
        )
        user["google_identity_verified_at"] = now_utc().isoformat()
        return user

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user:
        if user.get("blocked"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account has been blocked. Contact admin.")
        if user.get("google_sub") and user["google_sub"] != subject:
            _google_account_conflict(
                "This email is already linked to another Google account.",
                code="google_identity_conflict",
            )
        if user.get("auth_provider", "password") != "google":
            _google_account_conflict(
                "An account already exists for this email. Sign in with your password to link Google."
            )
        try:
            await db.users.update_one(
                {"id": user["id"]},
                {"$set": {
                    "google_sub": subject,
                    "google_linked_at": now_utc().isoformat(),
                    "google_identity_verified_at": now_utc().isoformat(),
                }},
            )
        except DuplicateKeyError as error:
            raise HTTPException(status.HTTP_409_CONFLICT, "This Google account is already linked") from error
        user["google_sub"] = subject
        user["google_identity_verified_at"] = now_utc().isoformat()
        return user

    if not allow_create:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No Hostel360 account exists for this Google identity")

    user = {
        "id": new_id(),
        "email": email,
        "name": claims.get("name"),
        "mobile": None,
        "role": "tenant",
        "auth_provider": "google",
        "google_sub": subject,
        "google_identity_verified_at": now_utc().isoformat(),
        "picture": claims.get("picture"),
        "blocked": False,
        "active": True,
        "hostel_id": None,
        "created_at": now_utc().isoformat(),
    }
    try:
        await db.users.insert_one(user)
    except DuplicateKeyError as error:
        # A concurrent login may have created or linked this identity first.
        existing = await db.users.find_one({"google_sub": subject}, {"_id": 0})
        if existing:
            if existing.get("blocked"):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account has been blocked. Contact admin.")
            return existing
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            if existing.get("google_sub") and existing["google_sub"] != subject:
                _google_account_conflict(
                    "This email is already linked to another Google account.",
                    code="google_identity_conflict",
                )
            _google_account_conflict(
                "An account already exists for this email. Sign in with your password to link Google."
            )
        raise HTTPException(status.HTTP_409_CONFLICT, "Unable to create the Google account; please retry") from error
    return user


@api.post("/auth/google")
async def google_login(body: GoogleTokenBody):
    claims = verify_google_identity(body.id_token)
    user = await _resolve_google_user(claims, allow_create=True)
    return {"access_token": make_token(user), "user": public_user(user)}


@api.post("/auth/google/link")
async def link_google_account(
    body: GoogleTokenBody,
    user: dict = Depends(get_current_user),
):
    claims = verify_google_identity(body.id_token)
    if claims["email"].strip().lower() != (user.get("email") or "").strip().lower():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Sign in to Google with the same email address as your Hostel360 account",
        )
    existing = await db.users.find_one({"google_sub": claims["sub"]}, {"_id": 0})
    if existing and existing.get("id") != user["id"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "This Google account is already linked to another account")
    if user.get("google_sub") and user["google_sub"] != claims["sub"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "A different Google account is already linked")
    try:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "google_sub": claims["sub"],
                "google_linked_at": now_utc().isoformat(),
                "google_identity_verified_at": now_utc().isoformat(),
            }},
        )
    except DuplicateKeyError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, "This Google account is already linked to another account") from error
    return {"user": public_user({
        **user,
        "google_sub": claims["sub"],
        "google_identity_verified_at": now_utc().isoformat(),
    })}


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
        result.append({
            key: h[key]
            for key in (
                "id", "name", "city", "area", "gender", "property_type", "photos",
                "min_rent", "rating", "verification_status", "status",
            )
            if key in h
        })
    return {"hostels": result}


@api.get("/public/hostels/{hostel_id}")
async def public_hostel_detail(
    hostel_id: str,
    user: dict = Depends(get_current_user),
):
    h = await db.hostels.find_one({"id": hostel_id}, {"_id": 0})
    if not h:
        raise HTTPException(404, "Hostel not found")
    reviews = await db.reviews.find({"hostel_id": hostel_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    rooms = await db.rooms.find({"hostel_id": hostel_id}, {"_id": 0}).to_list(None)
    available = 0
    for r in rooms:
        available += sum(1 for b in (r.get("beds") or []) if b.get("status") == "available")
    h["reviews"] = reviews
    h["available_beds"] = available
    h["room_options"] = [
        {"bed_count": len(r.get("beds") or []), "rent": r.get("rent")} for r in rooms
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
    owners = await db.users.find({"role": "owner"}, {"_id": 0, "password_hash": 0}).to_list(2000)
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

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: Optional[str]) -> Optional[str]:
        return _validate_password(value) if value is not None else None

    @model_validator(mode="after")
    def require_password_for_reset(self):
        if self.action == "reset_password" and self.new_password is None:
            raise ValueError("Provide a new password to reset this account")
        return self


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
        update["password_hash"] = hash_pw(body.new_password)
        await db.users.update_one({"id": owner_id}, {"$set": update})
        return {"ok": True}
    await db.users.update_one({"id": owner_id}, {"$set": update})
    return {"ok": True}


# Subscription plans (admin managed)
class PlanBody(BaseModel):
    name: str
    duration_months: int = Field(gt=0)
    price: float = Field(gt=0)
    gst_rates: Optional[List[Literal[2, 18]]] = None
    gst_rate: Optional[int] = None
    charge_type: Optional[Literal["platform_fee", "gst"]] = None
    features: List[str] = []
    active: bool = True

    @model_validator(mode="after")
    def validate_gst_rates(self):
        rates = self.gst_rates
        if not rates and self.gst_rate in (2, 18):
            rates = [self.gst_rate]
        if not rates:
            raise ValueError("Select at least one supported GST rate")
        if len(set(rates)) != len(rates):
            raise ValueError("GST rates cannot contain duplicates")
        rates = sorted(rates)
        total_rate = sum(rates)
        if self.gst_rate is not None and self.gst_rate not in (*rates, total_rate):
            raise ValueError("GST rate does not match the selected GST rates")
        self.gst_rates = rates
        self.gst_rate = total_rate
        self.charge_type = "gst"
        return self

    @field_validator("price")
    @classmethod
    def validate_price_precision(cls, value: float) -> float:
        price = Decimal(str(value))
        if not price.is_finite() or price.as_tuple().exponent < -2:
            raise ValueError("Price must have at most two decimal places")
        return value


@api.get("/plans")
async def list_plans(active_only: bool = False):
    query = {"active": True} if active_only else {}
    plans = await db.plans.find(query, {"_id": 0}).sort("duration_months", 1).to_list(100)
    return {"plans": plans}


@api.post("/admin/plans")
async def create_plan(body: PlanBody, user: dict = Depends(require_roles("admin"))):
    doc = {"id": new_id(), **body.model_dump(), "created_at": now_utc().isoformat()}
    await db.plans.insert_one(doc)
    return {"plan": clean(doc)}


@api.put("/admin/plans/{plan_id}")
async def update_plan(plan_id: str, body: PlanBody, user: dict = Depends(require_roles("admin"))):
    await db.plans.update_one({"id": plan_id}, {"$set": body.model_dump()})
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
    property_type: Literal[
        "boys_pg_hostel",
        "girls_pg_hostel",
        "co_living_pg",
        "co_living_hostel",
    ]
    photos: List[str] = []
    amenities: List[str] = []
    sharing_types: List[str] = []
    ownership_proof: Optional[str] = None
    min_rent: Optional[int] = None
    signature: Optional[str] = None
    upi_id: Optional[str] = Field(default=None, max_length=120)
    upi_qr_code: Optional[str] = Field(default=None, max_length=2_000_000)

    @field_validator("upi_id")
    @classmethod
    def validate_upi_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}", value):
            raise ValueError("Enter a valid UPI ID")
        return value

    @field_validator("upi_qr_code")
    @classmethod
    def validate_upi_qr_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value:
            return None
        if not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+", value):
            raise ValueError("Upload a valid JPG, PNG, or WebP UPI QR image")
        try:
            raw = base64.b64decode(value.split(",", 1)[1], validate=True)
        except (ValueError, base64.binascii.Error) as error:
            raise ValueError("UPI QR image data is invalid") from error
        if not raw or len(raw) > 1_000_000:
            raise ValueError("UPI QR images must be 1 MB or smaller")
        valid_signature = (
            raw.startswith(b"\xff\xd8\xff")
            if value.startswith("data:image/jpeg;")
            else raw.startswith(b"\x89PNG\r\n\x1a\n")
            if value.startswith("data:image/png;")
            else len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
        )
        if not valid_signature:
            raise ValueError("UPI QR image data does not match its file type")
        return value


@api.get("/owner/hostels")
async def owner_list_hostels(user: dict = Depends(require_roles("owner"))):
    hostels = await db.hostels.find({"owner_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"hostels": hostels}


@api.get("/owner/portfolio")
async def owner_portfolio(user: dict = Depends(require_roles("owner"))):
    hostels = await db.hostels.find({"owner_id": user["id"]}, {"_id": 0}).to_list(200)
    hids = [h["id"] for h in hostels]
    rooms = await db.rooms.find({"hostel_id": {"$in": hids}}, {"_id": 0}).to_list(None)
    tenants = await db.tenants.find({"hostel_id": {"$in": hids}, "active": True}, {"_id": 0}).to_list(5000)
    payments = await db.payments.find({"hostel_id": {"$in": hids}, "status": "paid"}, {"_id": 0}).to_list(20000)
    expenses = await db.expenses.find({"hostel_id": {"$in": hids}}, {"_id": 0}).to_list(20000)
    bed_counts = _room_bed_counts(rooms)
    total_beds = bed_counts["total"]
    occupied = bed_counts["occupied"]
    total_collection = sum(p.get("amount", 0) for p in payments)
    property_expenses = [e for e in expenses if _expense_purpose(e) == "property"]
    personal_expenses = [e for e in expenses if _expense_purpose(e) == "personal"]
    unclassified_expenses = [e for e in expenses if _expense_purpose(e) == "unclassified"]
    total_expenses = sum(e.get("amount", 0) for e in property_expenses)
    total_personal_expenses = sum(e.get("amount", 0) for e in personal_expenses)
    total_unclassified_expenses = sum(e.get("amount", 0) for e in unclassified_expenses)
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
        "available_beds": bed_counts["available"],
        "total_tenants": len(tenants),
        "total_collection": round(total_collection, 2),
        "total_expenses": round(total_expenses, 2),
        "personal_expenses": round(total_personal_expenses, 2),
        "unclassified_expenses": round(total_unclassified_expenses, 2),
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
    update = body.dict()
    if "upi_id" not in body.model_fields_set:
        update.pop("upi_id", None)
    if "upi_qr_code" not in body.model_fields_set:
        update.pop("upi_qr_code", None)
    await db.hostels.update_one({"id": hostel_id}, {"$set": update})
    h2 = await db.hostels.find_one({"id": hostel_id}, {"_id": 0})
    return {"hostel": h2}


@api.get("/owner/dashboard")
async def owner_dashboard(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"has_hostel": False}
    hid = h["id"]
    rooms = await db.rooms.find({"hostel_id": hid}, {"_id": 0}).to_list(None)
    tenants = await db.tenants.find({"hostel_id": hid, "active": True}, {"_id": 0}).to_list(2000)
    bed_counts = _room_bed_counts(rooms)
    total_beds = bed_counts["total"]
    occupied = bed_counts["occupied"]
    vacant_rooms = sum(1 for r in rooms if r.get("beds") and all(
        b.get("status") == "available" for b in r["beds"]))
    today = now_utc().date().isoformat()
    checkins = [t for t in tenants if (t.get("joining_date") or "")[:10] == today]
    # payments this month
    ym = now_utc().strftime("%Y-%m")
    payments = await db.payments.find({"hostel_id": hid}, {"_id": 0}).to_list(5000)
    month_collection = sum(p.get("amount", 0) for p in payments if (p.get("date") or "")[:7] == ym and p.get("status") == "paid")
    expenses = await db.expenses.find({"hostel_id": hid}, {"_id": 0}).to_list(5000)
    month_property_expenses = sum(
        e.get("amount", 0) for e in expenses
        if (e.get("date") or "")[:7] == ym and _expense_purpose(e) == "property"
    )
    month_personal_expenses = sum(
        e.get("amount", 0) for e in expenses
        if (e.get("date") or "")[:7] == ym and _expense_purpose(e) == "personal"
    )
    month_unclassified_expenses = sum(
        e.get("amount", 0) for e in expenses
        if (e.get("date") or "")[:7] == ym and _expense_purpose(e) == "unclassified"
    )
    pending = [t for t in tenants if t.get("payment_status") == "due"]
    upcoming_due = sum(t.get("monthly_rent", 0) for t in pending)
    return {
        "has_hostel": True,
        "hostel_status": h.get("status"),
        "total_rooms": len(rooms),
        "total_beds": total_beds,
        "occupied_beds": occupied,
        "available_beds": bed_counts["available"],
        "total_tenants": len(tenants),
        "vacant_rooms": vacant_rooms,
        "today_checkins": len(checkins),
        "today_checkouts": 0,
        "upcoming_rent_due": round(upcoming_due, 2),
        "monthly_collection": round(month_collection, 2),
        "monthly_expenses": round(month_property_expenses, 2),
        "monthly_personal_expenses": round(month_personal_expenses, 2),
        "monthly_unclassified_expenses": round(month_unclassified_expenses, 2),
        "monthly_profit": round(month_collection - month_property_expenses, 2),
        "pending_payments": len(pending),
        "occupancy_pct": round((occupied / total_beds * 100), 0) if total_beds else 0,
        "subscription": compute_sub_status(h),
    }


# Rooms
class RoomBody(BaseModel):
    hostel_id: Optional[str] = None
    floor: str
    room_number: str
    rent: int
    bed_count: int = Field(..., ge=1, le=7, strict=True)


@api.get("/owner/rooms")
async def owner_rooms(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"rooms": []}
    rooms = await db.rooms.find({"hostel_id": h["id"]}, {"_id": 0}).to_list(None)
    for room in rooms:
        room["bed_count"] = len(room.get("beds") or [])
        room.pop("room_type", None)
    return {"rooms": rooms}


@api.post("/owner/rooms")
async def owner_add_room(body: RoomBody, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, body.hostel_id)
    if not h:
        raise HTTPException(400, "Create your hostel first")
    floor = body.floor.strip()
    room_number = body.room_number.strip()
    if not floor or not room_number:
        raise HTTPException(422, "Floor and room number are required")
    key = _normalized_room_key(h["id"], floor, room_number)
    room_id = new_id()
    beds = [{"bed_number": f"{room_number}-{i+1}", "status": "available", "tenant_id": None}
            for i in range(body.bed_count)]
    doc = {"id": room_id, "hostel_id": h["id"], "floor": floor, "room_number": room_number,
           "rent": body.rent, "bed_count": body.bed_count, "beds": beds,
           "created_at": now_utc().isoformat()}
    try:
        await db.room_keys.insert_one({**key, "room_id": room_id})
    except DuplicateKeyError:
        raise HTTPException(409, "A room with this number already exists on this floor")
    try:
        await db.rooms.insert_one(doc)
    except Exception:
        await db.room_keys.delete_one({**key, "room_id": room_id})
        raise
    # Refresh public hostel metadata from persisted rooms and beds.
    await _refresh_hostel_meta(h["id"])
    return {"room": clean(doc)}


@api.delete("/owner/rooms/{room_id}")
async def owner_delete_room(room_id: str, user: dict = Depends(require_roles("owner"))):
    room = await db.rooms.find_one({"id": room_id})
    if not room or not await hostel_owned(user, room["hostel_id"]):
        raise HTTPException(404, "Room not found")
    if any(b.get("status") == "occupied" or b.get("tenant_id") for b in room.get("beds", [])):
        raise HTTPException(400, "Room has occupied beds")
    active_tenant = await db.tenants.find_one({"room_id": room_id, "active": True})
    if active_tenant:
        raise HTTPException(400, "Room has an active tenant")
    deleted = await db.rooms.delete_one({
        "id": room_id,
        "hostel_id": room["hostel_id"],
        "beds": room.get("beds", []) if "beds" in room else {"$exists": False},
    })
    if not deleted.deleted_count:
        raise HTTPException(409, "Room allocation changed; refresh and try again")

    key = _normalized_room_key(room["hostel_id"], room.get("floor", ""), room.get("room_number", ""))
    remaining_rooms = await db.rooms.find({"hostel_id": room["hostel_id"]}, {"_id": 0}).to_list(None)
    same_key_room = next((r for r in remaining_rooms if _normalized_room_key(
        r["hostel_id"], r.get("floor", ""), r.get("room_number", "")) == key), None)
    if same_key_room:
        await db.room_keys.update_one(key, {"$set": {"room_id": same_key_room["id"]}})
    else:
        await db.room_keys.delete_one({**key, "room_id": room_id})
    await _refresh_hostel_meta(room["hostel_id"])
    return {"ok": True}


async def _refresh_hostel_meta(hostel_id: str):
    rooms = await db.rooms.find({"hostel_id": hostel_id}, {"_id": 0}).to_list(None)
    if not rooms:
        await db.hostels.update_one({"id": hostel_id}, {"$set": {"min_rent": None, "sharing_types": []}})
        return
    min_rent = min(r.get("rent", 0) for r in rooms)
    sharing_by_bed_count = {1: "single", 2: "double"}
    sharing = sorted({
        sharing_by_bed_count.get(len(r.get("beds") or []), "triple")
        for r in rooms
    })
    await db.hostels.update_one({"id": hostel_id}, {"$set": {"min_rent": min_rent, "sharing_types": sharing}})


async def _ensure_room_key_index():
    rooms = await db.rooms.find(
        {}, {"_id": 0, "id": 1, "hostel_id": 1, "floor": 1, "room_number": 1, "beds": 1}
    ).to_list(None)
    grouped: dict[tuple[str, str, str], list[dict]] = {}
    for room in rooms:
        bed_count = len(room.get("beds") or [])
        if room.get("bed_count") != bed_count:
            await db.rooms.update_one({"id": room.get("id")}, {"$set": {"bed_count": bed_count}})
        key = _normalized_room_key(
            room.get("hostel_id", ""), room.get("floor", ""), room.get("room_number", "")
        )
        grouped.setdefault((key["hostel_id"], key["floor_key"], key["room_key"]), []).append(room)

    conflicts = [(key, entries) for key, entries in grouped.items() if len(entries) > 1]
    for (hostel_id, floor_key, room_key), entries in conflicts:
        logger.error(
            "Duplicate room migration conflict: hostel_id=%s floor=%r room_number=%r room_ids=%s. "
            "Resolve manually by renumbering/moving a room; do not delete tenant or payment data.",
            hostel_id, floor_key, room_key, [room.get("id") for room in entries],
        )

    await db.room_keys.create_index(
        [("hostel_id", 1), ("floor_key", 1), ("room_key", 1)], unique=True
    )
    for key_tuple, entries in grouped.items():
        hostel_id, floor_key, room_key = key_tuple
        key = {"hostel_id": hostel_id, "floor_key": floor_key, "room_key": room_key}
        await db.room_keys.update_one(
            key,
            {"$set": {"room_id": entries[0].get("id")}},
            upsert=True,
        )

# Tenants
def _tenant_aadhaar_hash(aadhaar_number: str) -> str:
    key = TENANT_AADHAAR_HMAC_KEY.encode("utf-8")
    if len(key) < 32:
        raise HTTPException(
            503,
            "Aadhaar duplicate checks are unavailable until TENANT_AADHAAR_HMAC_KEY is configured with at least 32 characters.",
        )
    return hmac.new(
        key,
        b"hostel360:tenant-aadhaar:v1:" + aadhaar_number.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


async def _aadhaar_duplicate_error(aadhaar_hash: str):
    claim = await db.tenant_aadhaar_claims.find_one({"aadhaar_hash": aadhaar_hash}, {"_id": 0})
    if claim:
        hostel_name = claim.get("hostel_name") or "another Hostel360 hostel"
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This Aadhaar number is already registered with hostel: {hostel_name}.",
        )


async def _aadhaar_legacy_match_error(aadhaar_number: str):
    possible_legacy_records = await db.tenants.find(
        {"aadhaar_last4": aadhaar_number[-4:]},
        {"_id": 0, "id": 1, "hostel_id": 1},
    ).to_list(100)
    for possible_legacy in possible_legacy_records:
        if await db.tenant_aadhaar_claims.find_one(
            {"tenant_id": possible_legacy.get("id")}, {"_id": 0, "id": 1}
        ):
            continue
        hostel = await db.hostels.find_one(
            {"id": possible_legacy.get("hostel_id")}, {"_id": 0, "name": 1}
        )
        hostel_name = hostel.get("name") if hostel else "another Hostel360 hostel"
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This Aadhaar number may already be registered with hostel: {hostel_name}. "
            "Verify the legacy record before continuing.",
        )


async def _ensure_tenant_aadhaar_claim_index():
    if len(TENANT_AADHAAR_HMAC_KEY.encode("utf-8")) < 32:
        logger.warning("Global Aadhaar duplicate checks are disabled: TENANT_AADHAAR_HMAC_KEY is not configured.")
        return

    await db.tenant_aadhaar_claims.create_index(
        "aadhaar_hash", unique=True, name="tenant_aadhaar_global_unique"
    )
    legacy_tenants = await db.tenants.find(
        {"$or": [
            {"aadhaar_number": {"$exists": True}},
            {"aadhaar": {"$exists": True}},
        ]},
        {"_id": 0, "id": 1, "hostel_id": 1, "aadhaar_number": 1, "aadhaar": 1},
    ).to_list(None)
    unrecoverable_legacy_count = await db.tenants.count_documents({
        "aadhaar_last4": {"$exists": True},
        "aadhaar_number": {"$exists": False},
        "aadhaar": {"$exists": False},
    })
    if unrecoverable_legacy_count:
        logger.warning(
            "Aadhaar migration cannot identify %s legacy tenant records that retain only the last four digits.",
            unrecoverable_legacy_count,
        )
    migrated: dict[str, dict] = {}
    for tenant in legacy_tenants:
        raw = tenant.get("aadhaar_number") or tenant.get("aadhaar")
        if not isinstance(raw, str):
            continue
        digits = re.sub(r"[\s-]", "", raw)
        if not re.fullmatch(r"\d{12}", digits):
            logger.error(
                "Legacy tenant has an invalid Aadhaar value; manual review required: tenant_id=%s hostel_id=%s",
                tenant.get("id"), tenant.get("hostel_id"),
            )
            continue
        aadhaar_hash = _tenant_aadhaar_hash(digits)
        previous = migrated.get(aadhaar_hash)
        if previous:
            logger.error(
                "Legacy Aadhaar duplicate requires manual review; records preserved: tenant_ids=%s hostel_ids=%s",
                [previous.get("id"), tenant.get("id")],
                [previous.get("hostel_id"), tenant.get("hostel_id")],
            )
        else:
            migrated[aadhaar_hash] = tenant
        hostel = await db.hostels.find_one({"id": tenant.get("hostel_id")}, {"_id": 0, "name": 1})
        claim = {
            "id": new_id(),
            "aadhaar_hash": aadhaar_hash,
            "tenant_id": tenant.get("id"),
            "hostel_id": tenant.get("hostel_id"),
            "hostel_name": hostel.get("name") if hostel else None,
            "status": "active",
            "created_at": now_utc().isoformat(),
        }
        try:
            await db.tenant_aadhaar_claims.insert_one(claim)
        except DuplicateKeyError:
            pass
        await db.tenants.update_one(
            {"id": tenant.get("id")},
            {"$unset": {"aadhaar_number": "", "aadhaar": ""}},
        )


class TenantBody(BaseModel):
    hostel_id: Optional[str] = None
    name: str
    mobile: str
    email: Optional[EmailStr] = None
    room_id: str
    bed_number: str
    joining_date: Optional[str] = None
    aadhaar_number: Optional[str] = None
    documents: dict[str, str] = Field(default_factory=dict)
    monthly_rent: int
    security_deposit: int = 0
    advance_amount: int = 0
    create_login: bool = False
    password: Optional[str] = None
    history_grant_id: Optional[str] = Field(default=None, min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def validate_tenant_name(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 120:
            raise ValueError("Enter a valid tenant name")
        return value

    @field_validator("mobile")
    @classmethod
    def validate_tenant_mobile(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"\+?[\d\s()-]+", value):
            raise ValueError("Enter a valid 10-digit mobile number")
        digits = re.sub(r"\D", "", value)
        if len(digits) != 10:
            raise ValueError("Enter a valid 10-digit mobile number")
        return digits

    @field_validator("joining_date")
    @classmethod
    def validate_joining_date(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return date.today().isoformat()
        try:
            return date.fromisoformat(value[:10]).isoformat()
        except (TypeError, ValueError):
            raise ValueError("Enter a valid joining date in YYYY-MM-DD format")

    @field_validator("aadhaar_number")
    @classmethod
    def validate_aadhaar_number(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        digits = re.sub(r"[\s-]", "", value)
        if not re.fullmatch(r"\d{12}", digits):
            raise ValueError("Enter a valid 12-digit Aadhaar number")
        return digits

    @field_validator("documents")
    @classmethod
    def validate_document_refs(cls, value: dict[str, str]) -> dict[str, str]:
        allowed = {"aadhaar_front", "aadhaar_back", "selfie"}
        if any(kind not in allowed for kind in value):
            raise ValueError("Unsupported tenant document type")
        if any(not re.fullmatch(r"[0-9a-f]{32}", upload_id) for upload_id in value.values()):
            raise ValueError("Invalid tenant document reference")
        if len(set(value.values())) != len(value):
            raise ValueError("Each tenant document must be uploaded separately")
        return value

    @field_validator("password")
    @classmethod
    def validate_login_password(cls, value: Optional[str]) -> Optional[str]:
        return _validate_password(value) if value is not None else None

    @model_validator(mode="after")
    def require_login_credentials(self):
        if self.create_login and not self.email:
            raise ValueError("An email address is required to create a tenant login")
        if self.create_login and self.password is None:
            raise ValueError("Provide a password to create a tenant login")
        return self


class TenantAadhaarCheckBody(BaseModel):
    aadhaar_number: str

    @field_validator("aadhaar_number")
    @classmethod
    def validate_aadhaar(cls, value: str) -> str:
        digits = re.sub(r"[\s-]", "", value.strip())
        if not re.fullmatch(r"\d{12}", digits):
            raise ValueError("Enter a valid 12-digit Aadhaar number")
        return digits


class TenantHistoryConsentBody(BaseModel):
    consented: StrictBool
    auto_lookup_consented: Optional[StrictBool] = None


class TenantHistoryLookupBody(BaseModel):
    code: str = Field(min_length=16, max_length=128)


class TenantHistoryAutomaticLookupBody(BaseModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().casefold()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            raise ValueError("Enter a valid email address")
        return normalized


class TenantReportBody(BaseModel):
    category: Literal[
        "unpaid_rent",
        "pending_utilities",
        "property_damage",
        "unpaid_agreed_charges",
        "other",
    ]
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=4000)
    amount_claimed: int = Field(default=0, ge=0, le=10_000_000)
    evidence_summary: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("title", "description")
    @classmethod
    def trim_report_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required")
        return value

    @field_validator("evidence_summary")
    @classmethod
    def trim_evidence_summary(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None


class TenantReportStatusBody(BaseModel):
    status: Literal[
        "reported_pending_verification",
        "under_review",
        "verified_outstanding",
        "resolved_paid",
        "rejected",
    ]
    note: Optional[str] = Field(default=None, max_length=1000)


class TenantReportResponseBody(BaseModel):
    response: str = Field(min_length=1, max_length=4000)

    @field_validator("response")
    @classmethod
    def trim_response(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Response is required")
        return value


class TenantReportSettlementBody(BaseModel):
    amount: int = Field(gt=0, le=10_000_000)
    note: Optional[str] = Field(default=None, max_length=1000)


@api.get("/owner/tenants")
async def owner_tenants(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"tenants": []}
    tenants = await db.tenants.find(
        {"hostel_id": h["id"], "deleted_at": {"$exists": False}}, {"_id": 0}
    ).sort("created_at", -1).to_list(2000)
    for tenant in tenants:
        refs = tenant.pop("documents", {})
        tenant.pop("aadhaar_number", None)
        tenant.pop("aadhaar", None)
        tenant["document_status"] = {kind: True for kind in refs}
    return {"tenants": tenants}


@api.post("/owner/tenants/check-aadhaar")
async def owner_check_tenant_aadhaar(
    body: TenantAadhaarCheckBody,
    hostel_id: str,
    user: dict = Depends(require_roles("owner")),
):
    hostel = await get_owner_hostel(user, hostel_id)
    if not hostel:
        raise HTTPException(404, "Hostel not found")
    await _aadhaar_duplicate_error(_tenant_aadhaar_hash(body.aadhaar_number))
    await _aadhaar_legacy_match_error(body.aadhaar_number)
    return {"available": True}


def _tenant_document_cipher() -> Fernet:
    if not TENANT_DOCUMENT_ENCRYPTION_KEY:
        raise HTTPException(
            503,
            "Tenant document storage is not configured. Set TENANT_DOCUMENT_ENCRYPTION_KEY before uploading documents.",
        )
    try:
        return Fernet(TENANT_DOCUMENT_ENCRYPTION_KEY.encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        raise HTTPException(503, "Tenant document encryption configuration is invalid")


def _tenant_document_path(document: dict) -> Path:
    document_id = document.get("id", "")
    extension = document.get("extension", "")
    if not re.fullmatch(r"[0-9a-f]{32}", document_id) or extension not in {"jpg", "png", "webp"}:
        raise HTTPException(404, "Tenant document not found")
    return TENANT_DOCUMENT_DIR / f"{document_id}.{extension}.enc"


def _tenant_document_refs(documents: list[dict]) -> dict[str, dict]:
    return {
        document["kind"]: {
            "id": document["id"],
            "kind": document["kind"],
            "content_type": document["content_type"],
            "size": document["size"],
            "uploaded_at": document["created_at"],
        }
        for document in documents
    }


@api.post("/owner/tenant-documents")
async def upload_tenant_document(
    hostel_id: str,
    kind: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("owner")),
):
    if kind not in {"aadhaar_front", "aadhaar_back", "selfie"}:
        raise HTTPException(400, "Choose a valid tenant document type")
    hostel = await get_owner_hostel(user, hostel_id)
    if not hostel:
        raise HTTPException(404, "Hostel not found")
    cipher = _tenant_document_cipher()
    content_type = (file.content_type or "").lower()
    extension_by_type = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
    extension = extension_by_type.get(content_type)
    if not extension:
        raise HTTPException(400, "Upload a JPG, PNG, or WebP image")

    content = bytearray()
    try:
        while chunk := await file.read(1024 * 1024):
            content.extend(chunk)
            if len(content) > TENANT_DOCUMENT_MAX_SIZE:
                raise HTTPException(413, "Tenant images must be 10 MB or smaller")
    finally:
        await file.close()
    raw = bytes(content)
    valid_signature = (
        (content_type == "image/jpeg" and raw.startswith(b"\xff\xd8\xff"))
        or (content_type == "image/png" and raw.startswith(b"\x89PNG\r\n\x1a\n"))
        or (content_type == "image/webp" and len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP")
    )
    if not raw or not valid_signature:
        raise HTTPException(400, "The selected image is invalid or does not match its file type")

    document_id = new_id()
    TENANT_DOCUMENT_DIR.mkdir(parents=True, exist_ok=True)
    path = TENANT_DOCUMENT_DIR / f"{document_id}.{extension}.enc"
    metadata = {
        "id": document_id,
        "owner_id": user["id"],
        "hostel_id": hostel["id"],
        "kind": kind,
        "content_type": content_type,
        "extension": extension,
        "size": len(raw),
        "created_at": now_utc().isoformat(),
        "tenant_id": None,
    }
    try:
        encrypted = await asyncio.to_thread(cipher.encrypt, raw)
        await asyncio.to_thread(path.write_bytes, encrypted)
        await db.tenant_document_uploads.insert_one(metadata)
    except Exception:
        if path.is_file():
            path.unlink()
        raise
    return {"upload_id": document_id, "kind": kind, "size": len(raw)}


@api.delete("/owner/tenant-documents/{upload_id}")
async def delete_staged_tenant_document(
    upload_id: str,
    user: dict = Depends(require_roles("owner")),
):
    document = await db.tenant_document_uploads.find_one({
        "id": upload_id,
        "owner_id": user["id"],
        "tenant_id": None,
    })
    if not document:
        return {"ok": True}
    path = _tenant_document_path(document)
    result = await db.tenant_document_uploads.delete_one({
        "id": upload_id,
        "owner_id": user["id"],
        "tenant_id": None,
    })
    if result.deleted_count and path.is_file():
        path.unlink()
    return {"ok": True}


TENANT_HISTORY_CODE_TTL = timedelta(minutes=10)
TENANT_HISTORY_GRANT_TTL = timedelta(minutes=15)


def _history_code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _history_expiry(value) -> Optional[datetime]:
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except (TypeError, ValueError):
        return None


def _history_report_summary(report: dict) -> dict:
    return {
        "id": report["id"],
        "previous_hostel": report.get("previous_hostel"),
        "category": report.get("category"),
        "status": report.get("status", "reported_pending_verification"),
        "amount": report.get("amount_claimed", 0),
        "amount_claimed": report.get("amount_claimed", 0),
        "outstanding_balance": report.get("outstanding_balance", report.get("amount_claimed", 0)),
        "reported_at": report.get("created_at"),
        "created_at": report.get("created_at"),
        "updated_at": report.get("updated_at"),
        "evidence_summary": report.get("evidence_summary"),
        "evidence_documents": [
            {
                "id": item.get("id"),
                "filename": item.get("filename"),
                "content_type": item.get("content_type"),
                "size": item.get("size"),
                "uploaded_at": item.get("created_at"),
            }
            for item in report.get("evidence_documents", [])
        ],
        "details_available": bool(report.get("description")),
        "details": report.get("description"),
        "tenant_response": report.get("tenant_response"),
        "stay_start_date": report.get("stay_start_date"),
        "vacated_at": report.get("vacated_at"),
        "resolved_at": report.get("resolved_at"),
        "resolution_details": report.get("resolution_details"),
    }


async def _valid_history_grant(grant_id: str, owner_id: str, hostel_id: str) -> Optional[dict]:
    grant = await db.tenant_history_grants.find_one({
        "id": grant_id,
        "owner_id": owner_id,
        "hostel_id": hostel_id,
    }, {"_id": 0})
    if (
        not grant
        or _history_expiry(grant.get("expires_at")) is None
        or _history_expiry(grant.get("expires_at")) <= now_utc()
    ):
        return None
    account = await db.users.find_one({"id": grant.get("tenant_user_id"), "role": "tenant"}, {"_id": 0})
    if not account or account.get("global_history_consented") is not True:
        return None
    if grant.get("access_mode") == "automatic" and (
        account.get("global_history_auto_lookup_consented") is not True
        or not account.get("google_sub")
        or not account.get("google_identity_verified_at")
    ):
        return None
    return grant


async def _notify_tenant_report_event(report: dict, event: str, actor_user_id: str):
    recipients = {
        (report.get("reporter_user_id"), "owner", report.get("hostel_id")),
        (report.get("tenant_user_id"), "tenant", report.get("hostel_id")),
    }
    recipient_grants = {}
    tenant_user_id = report.get("tenant_user_id")
    if tenant_user_id:
        grants = await db.tenant_history_grants.find({
            "tenant_user_id": tenant_user_id,
            "expires_at": {"$gt": now_utc()},
        }, {"_id": 0, "id": 1, "owner_id": 1, "hostel_id": 1}).to_list(500)
        for grant in grants:
            active_grant = await _valid_history_grant(
                grant.get("id"), grant.get("owner_id"), grant.get("hostel_id")
            )
            if active_grant:
                recipient = (grant.get("owner_id"), "owner", grant.get("hostel_id"))
                recipients.add(recipient)
                recipient_grants[recipient] = grant["id"]
        account = await db.users.find_one(
            {
                "id": tenant_user_id,
                "role": "tenant",
                "global_history_consented": True,
                "global_history_auto_lookup_consented": True,
                "google_sub": {"$exists": True},
                "google_identity_verified_at": {"$exists": True},
            },
            {"_id": 0, "id": 1},
        )
        if account:
            memberships = await db.tenants.find({
                "user_id": tenant_user_id,
                "active": True,
            }, {"_id": 0, "hostel_id": 1}).to_list(500)
            for membership in memberships:
                hostel = await db.hostels.find_one(
                    {"id": membership.get("hostel_id")}, {"_id": 0, "owner_id": 1}
                )
                if hostel and hostel.get("owner_id"):
                    recipients.add((hostel["owner_id"], "owner", membership.get("hostel_id")))

    records = []
    for recipient_id, role, recipient_hostel_id in recipients:
        if not recipient_id:
            continue
        recipient = (recipient_id, role, recipient_hostel_id)
        records.append({
            "id": new_id(),
            "recipient_user_id": recipient_id,
            "recipient_role": role,
            "hostel_id": recipient_hostel_id,
            "actor_user_id": actor_user_id,
            "report_id": report["id"],
            "grant_id": recipient_grants.get(recipient),
            "event": event,
            "status": report.get("status"),
            "created_at": now_utc().isoformat(),
            "read_at": None,
        })
    if records:
        try:
            await db.tenant_history_notifications.insert_many(records, ordered=False)
        except Exception:
            logger.exception(
                "Could not persist tenant-history notifications for report %s (%s)",
                report.get("id"),
                event,
            )


async def _tenant_report_for_owner(report_id: str, user: dict) -> Optional[dict]:
    report = await db.tenant_reports.find_one({"id": report_id}, {"_id": 0})
    if report and await hostel_owned(user, report.get("hostel_id")):
        return report
    return None


def _tenant_report_evidence_path(document: dict) -> Path:
    document_id = document.get("id", "")
    extension = document.get("extension", "")
    if not re.fullmatch(r"[0-9a-f]{32}", document_id) or extension not in {"jpg", "png", "webp", "pdf"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence document not found")
    return TENANT_REPORT_EVIDENCE_DIR / f"{document_id}.{extension}.enc"


async def _tenant_report_owner_access(report_id: str, user: dict, grant_id: Optional[str]):
    report = await db.tenant_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    if await hostel_owned(user, report.get("hostel_id")):
        return report
    if grant_id:
        grant_record = await db.tenant_history_grants.find_one({"id": grant_id}, {"_id": 0})
        grant = None
        if grant_record:
            grant = await _valid_history_grant(grant_id, user["id"], grant_record.get("hostel_id"))
        if grant and grant.get("tenant_user_id") == report.get("tenant_user_id"):
            return report
    tenant_user_id = report.get("tenant_user_id")
    if tenant_user_id:
        account = await db.users.find_one({
            "id": tenant_user_id,
            "role": "tenant",
            "global_history_consented": True,
            "global_history_auto_lookup_consented": True,
            "google_sub": {"$exists": True},
            "google_identity_verified_at": {"$exists": True},
        }, {"_id": 0, "id": 1})
        if account:
            memberships = await db.tenants.find({
                "user_id": tenant_user_id,
                "active": True,
            }, {"_id": 0, "hostel_id": 1}).to_list(500)
            for membership in memberships:
                if await hostel_owned(user, membership.get("hostel_id")):
                    return report
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")


@api.post("/owner/tenant-reports/{report_id}/evidence")
async def upload_tenant_report_evidence(
    report_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("owner")),
):
    report = await _tenant_report_for_owner(report_id, user)
    if not report or report.get("reporter_user_id") != user["id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    cipher = _tenant_document_cipher()
    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    extension_by_type = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "application/pdf": "pdf",
    }
    extension = extension_by_type.get(content_type)
    if not extension:
        raise HTTPException(400, "Upload a JPG, PNG, WebP, or PDF document")
    content = bytearray()
    try:
        while chunk := await file.read(1024 * 1024):
            content.extend(chunk)
            if len(content) > TENANT_REPORT_EVIDENCE_MAX_SIZE:
                raise HTTPException(413, "Evidence documents must be 10 MB or smaller")
    finally:
        await file.close()
    raw = bytes(content)
    signatures = {
        "image/jpeg": raw.startswith(b"\xff\xd8\xff"),
        "image/png": raw.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP",
        "application/pdf": raw.startswith(b"%PDF-"),
    }
    if not raw or not signatures[content_type]:
        raise HTTPException(400, "The selected evidence does not match its file type")
    if content_type.startswith("image/"):
        try:
            with Image.open(BytesIO(raw)) as image:
                if image.width * image.height > 40_000_000:
                    raise HTTPException(413, "Evidence image dimensions are too large")
                image.verify()
        except HTTPException:
            raise
        except (UnidentifiedImageError, OSError, ValueError) as error:
            raise HTTPException(400, "The selected evidence image is invalid") from error

    original_name = Path(file.filename or f"evidence.{extension}").name
    safe_name = re.sub(r"[^A-Za-z0-9._ -]", "_", original_name).strip(" .")[:160]
    if not safe_name:
        safe_name = f"evidence.{extension}"
    evidence_id = new_id()
    TENANT_REPORT_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    path = TENANT_REPORT_EVIDENCE_DIR / f"{evidence_id}.{extension}.enc"
    metadata = {
        "id": evidence_id,
        "report_id": report_id,
        "tenant_id": report.get("tenant_id"),
        "tenant_user_id": report.get("tenant_user_id"),
        "owner_id": user["id"],
        "hostel_id": report["hostel_id"],
        "filename": safe_name,
        "content_type": content_type,
        "extension": extension,
        "size": len(raw),
        "created_at": now_utc().isoformat(),
    }
    try:
        encrypted = await asyncio.to_thread(cipher.encrypt, raw)
        await asyncio.to_thread(path.write_bytes, encrypted)
        await db.tenant_report_evidence.insert_one(metadata)
        await db.tenant_reports.update_one(
            {"id": report_id, "reporter_user_id": user["id"]},
            {"$push": {"evidence_documents": metadata}},
        )
        await db.tenant_history_audit.insert_one({
            "id": new_id(),
            "actor_user_id": user["id"],
            "tenant_user_id": report.get("tenant_user_id"),
            "hostel_id": report["hostel_id"],
            "report_id": report_id,
            "evidence_id": evidence_id,
            "action": "report_evidence_uploaded",
            "created_at": now_utc().isoformat(),
        })
    except Exception:
        if path.is_file():
            path.unlink()
        await db.tenant_reports.update_one(
            {"id": report_id, "reporter_user_id": user["id"]},
            {"$pull": {"evidence_documents": {"id": evidence_id}}},
        )
        await db.tenant_report_evidence.delete_one({"id": evidence_id})
        raise
    return {"evidence": _history_report_summary({"id": report_id, "evidence_documents": [metadata]})["evidence_documents"][0]}


@api.get("/owner/tenant-reports/{report_id}/evidence/{evidence_id}")
async def get_tenant_report_evidence(
    report_id: str,
    evidence_id: str,
    grant_id: Optional[str] = None,
    user: dict = Depends(require_roles("owner")),
):
    report = await _tenant_report_owner_access(report_id, user, grant_id)
    evidence = await db.tenant_report_evidence.find_one({
        "id": evidence_id,
        "report_id": report_id,
        "hostel_id": report["hostel_id"],
    }, {"_id": 0})
    if not evidence:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence document not found")
    path = _tenant_report_evidence_path(evidence)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence file is unavailable")
    try:
        encrypted = await asyncio.to_thread(path.read_bytes)
        content = await asyncio.to_thread(_tenant_document_cipher().decrypt, encrypted)
    except InvalidToken as error:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Evidence could not be decrypted") from error
    return Response(
        content=content,
        media_type=evidence["content_type"],
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'attachment; filename="{evidence["filename"]}"',
        },
    )


async def _user_history_notifications(user: dict, role: str, hostel_id: Optional[str] = None):
    query = {"recipient_user_id": user["id"], "recipient_role": role}
    if hostel_id:
        if role == "owner" and not await hostel_owned(user, hostel_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Hostel not found")
        query["hostel_id"] = hostel_id
    records = await db.tenant_history_notifications.find(
        query,
        {"_id": 0, "id": 1, "event": 1, "report_id": 1, "payment_id": 1, "grant_id": 1,
         "status": 1, "message": 1, "amount": 1, "created_at": 1, "read_at": 1,
         "tenant_name": 1, "room_number": 1, "method": 1, "upi_reference": 1,
         "payment_submitted_at": 1, "rejection_reason": 1},
    ).sort("created_at", -1).to_list(100)
    response = {"notifications": records}
    if role == "owner":
        response["pending_payment_count"] = await db.tenant_history_notifications.count_documents({
            **query,
            "payment_id": {"$exists": True},
            "status": {"$in": ["pending_owner_approval", "approval_processing"]},
        })
    return response


@api.get("/owner/tenant-history/notifications")
async def owner_tenant_history_notifications(
    user: dict = Depends(require_roles("owner")),
    hostel_id: Optional[str] = None,
):
    return await _user_history_notifications(user, "owner", hostel_id)


@api.get("/tenant/global-history/notifications")
async def tenant_global_history_notifications(user: dict = Depends(require_roles("tenant"))):
    return await _user_history_notifications(user, "tenant")


@api.put("/tenant-history/notifications/{notification_id}/read")
async def mark_tenant_history_notification_read(
    notification_id: str,
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in {"owner", "tenant"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized")
    changed = await db.tenant_history_notifications.update_one(
        {
            "id": notification_id,
            "recipient_user_id": user["id"],
            "recipient_role": user["role"],
        },
        {"$set": {"read_at": now_utc().isoformat()}},
    )
    if changed.matched_count != 1:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    return {"ok": True}


@api.get("/tenant/global-history/consent")
async def tenant_global_history_consent(user: dict = Depends(require_roles("tenant"))):
    account = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return {
        "consented": bool(account and account.get("global_history_consented") is True),
        "auto_lookup_consented": bool(account and account.get("global_history_auto_lookup_consented") is True),
        "identity_verified": bool(account and account.get("google_sub") and account.get("google_identity_verified_at")),
    }


@api.put("/tenant/global-history/consent")
async def tenant_set_global_history_consent(
    body: TenantHistoryConsentBody,
    user: dict = Depends(require_roles("tenant")),
):
    if body.auto_lookup_consented is True and not body.consented:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Global history sharing must be enabled before automatic verified lookup can be enabled",
        )
    changed_at = now_utc().isoformat()
    consent_update = {
        "global_history_consented": body.consented,
        "global_history_consent_updated_at": changed_at,
    }
    if body.auto_lookup_consented is not None:
        consent_update["global_history_auto_lookup_consented"] = body.auto_lookup_consented
        consent_update["global_history_auto_lookup_updated_at"] = changed_at
    if not body.consented:
        consent_update["global_history_auto_lookup_consented"] = False
        consent_update["global_history_auto_lookup_updated_at"] = changed_at
    changed = await db.users.update_one(
        {"id": user["id"], "role": "tenant"},
        {"$set": consent_update},
    )
    if changed.matched_count != 1:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant account not found")
    await db.tenant_history_audit.insert_one({
        "id": new_id(),
        "actor_user_id": user["id"],
        "action": "consent_enabled" if body.consented else "consent_revoked",
        "auto_lookup_consented": body.auto_lookup_consented,
        "created_at": changed_at,
    })
    return {
        "consented": body.consented,
        "auto_lookup_consented": consent_update.get("global_history_auto_lookup_consented"),
    }


@api.post("/tenant/global-history/share-code")
async def tenant_create_global_history_share_code(user: dict = Depends(require_roles("tenant"))):
    account = await db.users.find_one({"id": user["id"], "role": "tenant"}, {"_id": 0})
    if not account or account.get("global_history_consented") is not True:
        raise HTTPException(status.HTTP_409_CONFLICT, "Enable global history consent before sharing a code")
    code = secrets.token_urlsafe(24)
    expires_at = now_utc() + TENANT_HISTORY_CODE_TTL
    await db.tenant_history_share_codes.insert_one({
        "id": new_id(),
        "code_hash": _history_code_hash(code),
        "tenant_user_id": user["id"],
        "expires_at": expires_at,
        "used_at": None,
        "created_at": now_utc().isoformat(),
    })
    return {"code": code, "expires_at": expires_at.isoformat()}


@api.post("/owner/tenant-history/lookup")
async def owner_lookup_tenant_history(
    body: TenantHistoryLookupBody,
    hostel_id: Optional[str] = None,
    user: dict = Depends(require_roles("owner")),
):
    hostel = await get_owner_hostel(user, hostel_id)
    if not hostel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hostel not found")
    code_record = await db.tenant_history_share_codes.find_one({
        "code_hash": _history_code_hash(body.code),
        "used_at": None,
    }, {"_id": 0})
    if (
        not code_record
        or _history_expiry(code_record.get("expires_at")) is None
        or _history_expiry(code_record.get("expires_at")) <= now_utc()
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share code is invalid, expired, or already used")
    account = await db.users.find_one({"id": code_record.get("tenant_user_id"), "role": "tenant"}, {"_id": 0})
    if not account or account.get("global_history_consented") is not True:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share code is invalid, expired, or already used")
    consumed = await db.tenant_history_share_codes.update_one(
        {"id": code_record["id"], "used_at": None},
        {"$set": {"used_at": now_utc().isoformat(), "used_by_owner_id": user["id"]}},
    )
    if consumed.matched_count != 1:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share code is invalid, expired, or already used")

    grant_id = new_id()
    grant_expiry = now_utc() + TENANT_HISTORY_GRANT_TTL
    await db.tenant_history_grants.insert_one({
        "id": grant_id,
        "owner_id": user["id"],
        "hostel_id": hostel["id"],
        "tenant_user_id": account["id"],
        "expires_at": grant_expiry,
        "membership_used_at": None,
        "created_at": now_utc().isoformat(),
    })
    history_reports = await db.tenant_reports.find(
        {"tenant_user_id": account["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    for report in history_reports:
        previous_hostel = await db.hostels.find_one(
            {"id": report.get("hostel_id")}, {"_id": 0, "name": 1}
        )
        report["previous_hostel"] = previous_hostel.get("name") if previous_hostel else None
    await db.tenant_history_audit.insert_one({
        "id": new_id(),
        "actor_user_id": user["id"],
        "tenant_user_id": account["id"],
        "hostel_id": hostel["id"],
        "action": "history_lookup_granted",
        "grant_id": grant_id,
        "created_at": now_utc().isoformat(),
    })
    return {
        "grant_id": grant_id,
        "reports": [_history_report_summary(report) for report in history_reports],
    }


@api.post("/owner/tenant-history/automatic-lookup")
async def owner_automatic_tenant_history_lookup(
    body: TenantHistoryAutomaticLookupBody,
    hostel_id: Optional[str] = None,
    user: dict = Depends(require_roles("owner")),
):
    hostel = await get_owner_hostel(user, hostel_id)
    if not hostel:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hostel not found")
    account = await db.users.find_one(
        {
            "email": body.email,
            "role": "tenant",
            "global_history_consented": True,
            "global_history_auto_lookup_consented": True,
            "google_sub": {"$exists": True},
            "google_identity_verified_at": {"$exists": True},
        },
        {"_id": 0},
    )
    if not account or not account.get("google_sub") or not account.get("google_identity_verified_at"):
        return {"grant_id": None, "reports": []}
    existing_membership = await db.tenants.find_one({
        "hostel_id": hostel["id"],
        "user_id": account["id"],
        "active": True,
    })
    if existing_membership:
        raise HTTPException(status.HTTP_409_CONFLICT, "This tenant already has an active membership at this hostel")

    reusable = await db.tenant_history_grants.find_one({
        "owner_id": user["id"],
        "hostel_id": hostel["id"],
        "tenant_user_id": account["id"],
        "access_mode": "automatic",
        "membership_used_at": None,
        "expires_at": {"$gt": now_utc()},
    }, {"_id": 0})
    grant = (
        await _valid_history_grant(reusable["id"], user["id"], hostel["id"])
        if reusable
        else None
    )
    if not grant:
        grant_id = new_id()
        grant_expiry = now_utc() + TENANT_HISTORY_GRANT_TTL
        grant = {
            "id": grant_id,
            "owner_id": user["id"],
            "hostel_id": hostel["id"],
            "tenant_user_id": account["id"],
            "access_mode": "automatic",
            "expires_at": grant_expiry,
            "membership_used_at": None,
            "created_at": now_utc().isoformat(),
        }
        await db.tenant_history_grants.insert_one(grant)
    grant_id = grant["id"]
    history_reports = await db.tenant_reports.find(
        {"tenant_user_id": account["id"], "hostel_id": {"$ne": hostel["id"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    for report in history_reports:
        previous_hostel = await db.hostels.find_one(
            {"id": report.get("hostel_id")}, {"_id": 0, "name": 1}
        )
        report["previous_hostel"] = previous_hostel.get("name") if previous_hostel else None
    await db.tenant_history_audit.insert_one({
        "id": new_id(),
        "actor_user_id": user["id"],
        "tenant_user_id": account["id"],
        "hostel_id": hostel["id"],
        "action": "automatic_history_lookup_granted",
        "grant_id": grant_id,
        "created_at": now_utc().isoformat(),
    })
    return {
        "grant_id": grant_id,
        "reports": [_history_report_summary(report) for report in history_reports],
    }


@api.post("/owner/tenants")
async def owner_add_tenant(body: TenantBody, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, body.hostel_id)
    if not h:
        raise HTTPException(400, "Create your hostel first")
    aadhaar_hash = _tenant_aadhaar_hash(body.aadhaar_number) if body.aadhaar_number else None
    if aadhaar_hash:
        await _aadhaar_duplicate_error(aadhaar_hash)
        await _aadhaar_legacy_match_error(body.aadhaar_number)
    grant = None
    if body.history_grant_id:
        grant = await _valid_history_grant(body.history_grant_id, user["id"], h["id"])
        if not grant:
            raise HTTPException(status.HTTP_409_CONFLICT, "History grant is invalid, expired, or belongs to another hostel")
        if grant.get("membership_used_at"):
            raise HTTPException(status.HTTP_409_CONFLICT, "History grant has already been used")
        if body.email:
            tenant_account = await db.users.find_one(
                {"id": grant["tenant_user_id"], "role": "tenant"}, {"_id": 0}
            )
            if not tenant_account or tenant_account.get("email", "").casefold() != str(body.email).casefold():
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "The tenant email does not match the account that shared this history code.",
                )
        existing_membership = await db.tenants.find_one({
            "hostel_id": h["id"],
            "user_id": grant["tenant_user_id"],
            "active": True,
        })
        if existing_membership:
            raise HTTPException(status.HTTP_409_CONFLICT, "This tenant already has an active membership at this hostel")
    elif body.email:
        possible_account = await db.users.find_one({"email": body.email.lower(), "role": "tenant"})
        if possible_account:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This email is already registered. The tenant must sign in and share verified history before this account can be linked.",
            )
    room = await db.rooms.find_one({"id": body.room_id, "hostel_id": h["id"]})
    if not room:
        raise HTTPException(404, "Room not found")
    bed = next((b for b in room.get("beds", []) if b["bed_number"] == body.bed_number), None)
    if not bed:
        raise HTTPException(404, "Bed not found")
    if bed.get("status") == "occupied":
        raise HTTPException(400, "Bed already occupied")

    staged_documents = []
    for kind, upload_id in body.documents.items():
        document = await db.tenant_document_uploads.find_one({
            "id": upload_id,
            "owner_id": user["id"],
            "hostel_id": h["id"],
            "kind": kind,
            "tenant_id": None,
        })
        if not document or not _tenant_document_path(document).is_file():
            raise HTTPException(400, f"Upload the selected {kind.replace('_', ' ')} again")
        staged_documents.append(document)

    tenant_id = new_id()
    claimed = await db.rooms.update_one(
        {
            "id": body.room_id,
            "hostel_id": h["id"],
            "beds": {"$elemMatch": {"bed_number": body.bed_number, "status": "available"}},
        },
        {"$set": {"beds.$.status": "occupied", "beds.$.tenant_id": tenant_id}},
    )
    if not claimed.modified_count:
        raise HTTPException(409, "Bed is no longer available; refresh and try again")

    membership_lock_id = None
    if grant:
        membership_lock_id = new_id()
        lock_time = now_utc()
        acquired = await db.users.update_one(
            {
                "id": grant["tenant_user_id"],
                "role": "tenant",
                "$or": [
                    {"membership_registration_lock_at": {"$exists": False}},
                    {"membership_registration_lock_at": {"$lt": lock_time - timedelta(minutes=5)}},
                ],
            },
            {"$set": {
                "membership_registration_lock_id": membership_lock_id,
                "membership_registration_lock_at": lock_time,
            }},
        )
        if acquired.matched_count != 1:
            await db.rooms.update_one(
                {"id": body.room_id, "beds.bed_number": body.bed_number, "beds.tenant_id": tenant_id},
                {"$set": {"beds.$.status": "available", "beds.$.tenant_id": None}},
            )
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This tenant is already being registered. Refresh and try again shortly.",
            )

    reserved_uploads = []
    tenant_inserted = False
    aadhaar_claim_id = None
    created_user_id = None
    user_id = grant.get("tenant_user_id") if grant else None
    existing_user_snapshot = None
    try:
        if aadhaar_hash:
            aadhaar_claim_id = new_id()
            try:
                await db.tenant_aadhaar_claims.insert_one({
                    "id": aadhaar_claim_id,
                    "aadhaar_hash": aadhaar_hash,
                    "tenant_id": tenant_id,
                    "hostel_id": h["id"],
                    "hostel_name": h.get("name"),
                    "status": "pending",
                    "created_at": now_utc().isoformat(),
                })
            except DuplicateKeyError as error:
                aadhaar_claim_id = None
                await _aadhaar_duplicate_error(aadhaar_hash)
                raise HTTPException(409, "Aadhaar registration could not be reserved. Please retry.") from error
        for document in staged_documents:
            reserved = await db.tenant_document_uploads.update_one(
                {
                    "id": document["id"],
                    "owner_id": user["id"],
                    "hostel_id": h["id"],
                    "tenant_id": None,
                },
                {"$set": {"tenant_id": tenant_id}},
            )
            if not reserved.modified_count:
                raise HTTPException(409, "A selected document is already in use; upload it again")
            reserved_uploads.append(document["id"])

        if body.create_login and body.email and not user_id:
            exists = await db.users.find_one({"email": body.email.lower()})
            if exists:
                if exists.get("role") != "tenant":
                    raise HTTPException(status.HTTP_409_CONFLICT, "Email belongs to a non-tenant account")
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "This email is already registered. The tenant must sign in and share verified history before this account can be linked.",
                )
            else:
                tu = {
                    "id": new_id(), "email": body.email.lower(),
                    "password_hash": hash_pw(body.password),
                    "name": body.name, "mobile": body.mobile, "role": "tenant",
                    "auth_provider": "password", "blocked": False, "active": True,
                    "must_change_password": body.password == TENANT_INITIAL_PASSWORD,
                    "hostel_id": h["id"], "created_at": now_utc().isoformat(),
                }
                try:
                    await db.users.insert_one(tu)
                except DuplicateKeyError as error:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "This tenant account was created concurrently. Refresh and sign in with that account.",
                    ) from error
                user_id = tu["id"]
                created_user_id = user_id

        tenant = {
            "id": tenant_id,
            "hostel_id": h["id"],
            "user_id": user_id,
            "identity_guarded": bool(user_id and grant),
            "tenant_code": "T" + new_id()[:6].upper(),
            "name": body.name,
            "mobile": body.mobile,
            "email": body.email,
            "room_id": body.room_id,
            "floor": room.get("floor"),
            "room_number": room["room_number"],
            "bed_number": body.bed_number,
            "joining_date": body.joining_date,
            "aadhaar_last4": body.aadhaar_number[-4:] if body.aadhaar_number else None,
            "documents": _tenant_document_refs(staged_documents),
            "monthly_rent": body.monthly_rent,
            "security_deposit": body.security_deposit,
            "advance_amount": body.advance_amount,
            "payment_status": "due",
            "active": True,
            "created_at": now_utc().isoformat(),
        }
        await db.tenants.insert_one(tenant)
        tenant_inserted = True
        if user_id:
            if not created_user_id:
                existing_user_snapshot = await db.users.find_one({"id": user_id}, {"_id": 0})
            await db.users.update_one({"id": user_id}, {"$set": {"hostel_id": h["id"], "tenant_id": tenant_id}})
        if grant:
            grant_use = await db.tenant_history_grants.update_one(
                {"id": grant["id"], "owner_id": user["id"], "hostel_id": h["id"], "membership_used_at": None},
                {"$set": {"membership_used_at": now_utc().isoformat(), "membership_id": tenant_id}},
            )
            if grant_use.matched_count != 1:
                raise HTTPException(status.HTTP_409_CONFLICT, "History grant has already been used")
        if aadhaar_claim_id:
            finalized_claim = await db.tenant_aadhaar_claims.update_one(
                {"id": aadhaar_claim_id, "status": "pending"},
                {"$set": {"status": "active"}},
            )
            if finalized_claim.matched_count != 1:
                raise HTTPException(503, "Aadhaar registration could not be finalized. Please retry.")
        safe_tenant = {
            key: value for key, value in tenant.items()
            if key not in {"documents", "aadhaar_number", "aadhaar"}
        }
        return {"tenant": clean(safe_tenant)}
    except Exception:
        if aadhaar_claim_id:
            await db.tenant_aadhaar_claims.delete_one({"id": aadhaar_claim_id, "status": "pending"})
        if tenant_inserted:
            await db.tenants.delete_one({"id": tenant_id})
        if existing_user_snapshot:
            await db.users.update_one(
                {"id": user_id},
                {"$set": {
                    "hostel_id": existing_user_snapshot.get("hostel_id"),
                    "tenant_id": existing_user_snapshot.get("tenant_id"),
                }},
            )
        await db.rooms.update_one(
            {"id": body.room_id, "beds.bed_number": body.bed_number, "beds.tenant_id": tenant_id},
            {"$set": {"beds.$.status": "available", "beds.$.tenant_id": None}},
        )
        for upload_id in reserved_uploads:
            await db.tenant_document_uploads.update_one(
                {"id": upload_id, "owner_id": user["id"], "tenant_id": tenant_id},
                {"$set": {"tenant_id": None}},
            )
        if created_user_id:
            await db.users.delete_one({"id": created_user_id})
        raise
    finally:
        if membership_lock_id:
            await db.users.update_one(
                {
                    "id": grant["tenant_user_id"],
                    "membership_registration_lock_id": membership_lock_id,
                },
                {"$unset": {
                    "membership_registration_lock_id": "",
                    "membership_registration_lock_at": "",
                }},
            )


@api.get("/owner/tenants/{tenant_id}")
async def owner_get_tenant(tenant_id: str, user: dict = Depends(require_roles("owner"))):
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    hostel = await hostel_owned(user, tenant["hostel_id"])
    if not hostel:
        raise HTTPException(404, "Tenant not found")
    references = tenant.get("documents", {})
    reference_ids = [
        reference.get("id")
        for reference in references.values()
        if isinstance(reference, dict) and reference.get("id")
    ]
    room, stored_documents = await asyncio.gather(
        db.rooms.find_one({"id": tenant.get("room_id"), "hostel_id": tenant["hostel_id"]}, {"_id": 0}),
        db.tenant_document_uploads.find({
            "id": {"$in": reference_ids},
            "hostel_id": tenant["hostel_id"],
            "tenant_id": tenant_id,
            "owner_id": user["id"],
        }, {"_id": 0}).to_list(len(reference_ids)) if reference_ids else asyncio.sleep(0, result=[]),
    )
    documents = {}
    stored_by_id = {document["id"]: document for document in stored_documents}
    for kind, reference in references.items():
        document = stored_by_id.get(reference.get("id")) if isinstance(reference, dict) else None
        if document and document.get("kind") != kind:
            document = None
        if document and _tenant_document_path(document).is_file():
            documents[kind] = {
                "available": True,
                "size": document["size"],
                "content_type": document["content_type"],
            }
    safe_tenant = {
        key: value for key, value in tenant.items()
        if key not in {"documents", "aadhaar_number", "aadhaar"}
    }
    safe_tenant["aadhaar_last4"] = tenant.get("aadhaar_last4")
    safe_tenant["joining_date"] = tenant.get("joining_date")
    return {
        "tenant": clean(safe_tenant),
        "hostel": {"id": hostel["id"], "name": hostel.get("name")} if hostel else None,
        "room": {
            "floor": room.get("floor"),
            "room_number": room.get("room_number"),
        } if room else None,
        "documents": documents,
    }


@api.get("/owner/tenants/{tenant_id}/documents/{kind}")
async def owner_get_tenant_document(
    tenant_id: str,
    kind: str,
    user: dict = Depends(require_roles("owner")),
):
    if kind not in {"aadhaar_front", "aadhaar_back", "selfie"}:
        raise HTTPException(404, "Tenant document not found")
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant or not await hostel_owned(user, tenant["hostel_id"]):
        raise HTTPException(404, "Tenant document not found")
    reference = tenant.get("documents", {}).get(kind)
    if not reference:
        raise HTTPException(404, "Tenant document not found")
    document = await db.tenant_document_uploads.find_one({
        "id": reference["id"],
        "owner_id": user["id"],
        "hostel_id": tenant["hostel_id"],
        "tenant_id": tenant_id,
        "kind": kind,
    })
    if not document:
        raise HTTPException(404, "Tenant document not found")
    path = _tenant_document_path(document)
    if not path.is_file():
        raise HTTPException(404, "Tenant document file not found")
    try:
        encrypted = await asyncio.to_thread(path.read_bytes)
        content = await asyncio.to_thread(_tenant_document_cipher().decrypt, encrypted)
    except InvalidToken:
        raise HTTPException(500, "Tenant document could not be decrypted")
    return Response(
        content=content,
        media_type=document["content_type"],
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
        },
    )


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
    claimed = await db.rooms.update_one(
        {
            "id": body.room_id,
            "hostel_id": t["hostel_id"],
            "beds": {"$elemMatch": {"bed_number": body.bed_number, "status": "available"}},
        },
        {"$set": {"beds.$.status": "occupied", "beds.$.tenant_id": tenant_id}},
    )
    if not claimed.modified_count:
        raise HTTPException(409, "Bed is no longer available; refresh and try again")
    changed = await db.tenants.update_one(
        {"id": tenant_id, "room_id": t["room_id"], "bed_number": t["bed_number"], "active": True},
        {"$set": {
            "room_id": body.room_id,
            "room_number": new_room["room_number"],
            "bed_number": body.bed_number,
            "monthly_rent": new_room.get("rent", t["monthly_rent"]),
        }},
    )
    if not changed.modified_count:
        await db.rooms.update_one(
            {"id": body.room_id, "beds.bed_number": body.bed_number, "beds.tenant_id": tenant_id},
            {"$set": {"beds.$.status": "available", "beds.$.tenant_id": None}},
        )
        raise HTTPException(409, "Tenant allocation changed; refresh and try again")
    await db.rooms.update_one(
        {"id": t["room_id"], "beds.bed_number": t["bed_number"], "beds.tenant_id": tenant_id},
        {"$set": {"beds.$.status": "available", "beds.$.tenant_id": None}},
    )
    t2 = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    return {"tenant": t2}


@api.post("/owner/tenants/{tenant_id}/checkout")
async def owner_checkout_tenant(tenant_id: str, user: dict = Depends(require_roles("owner"))):
    t = await db.tenants.find_one({"id": tenant_id})
    if not t or not await hostel_owned(user, t["hostel_id"]):
        raise HTTPException(404, "Tenant not found")
    changed = await db.tenants.update_one(
        {
            "id": tenant_id,
            "active": True,
            "room_id": t.get("room_id"),
            "bed_number": t.get("bed_number"),
        },
        {"$set": {"active": False, "checkout_date": now_utc().isoformat()}},
    )
    if not changed.modified_count:
        current = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "active": 1})
        if current and not current.get("active"):
            return {"ok": True, "already_checked_out": True}
        raise HTTPException(409, "Tenant allocation changed; refresh and try again")
    await db.rooms.update_one(
        {"id": t["room_id"], "beds.bed_number": t["bed_number"], "beds.tenant_id": tenant_id},
        {"$set": {"beds.$.status": "available", "beds.$.tenant_id": None}},
    )
    return {"ok": True, "already_checked_out": False}


@api.delete("/owner/tenants/{tenant_id}")
async def owner_delete_tenant(tenant_id: str, user: dict = Depends(require_roles("owner"))):
    t = await db.tenants.find_one({"id": tenant_id})
    if not t or not await hostel_owned(user, t["hostel_id"]):
        raise HTTPException(404, "Tenant not found")
    archive_query = {"id": tenant_id, "deleted_at": {"$exists": False}}
    if t.get("active"):
        archive_query.update({
            "active": True,
            "room_id": t.get("room_id"),
            "bed_number": t.get("bed_number"),
        })
    else:
        archive_query["active"] = {"$ne": True}
    changed = await db.tenants.update_one(
        archive_query,
        {"$set": {"active": False, "deleted_at": now_utc().isoformat(), "checkout_date": t.get("checkout_date") or now_utc().isoformat()}},
    )
    if not changed.modified_count:
        current = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "deleted_at": 1})
        if current and current.get("deleted_at"):
            return {"ok": True, "already_archived": True}
        raise HTTPException(409, "Tenant allocation changed; refresh and try again")
    if changed.modified_count and t.get("active"):
        await db.rooms.update_one(
            {"id": t["room_id"], "beds.bed_number": t["bed_number"], "beds.tenant_id": tenant_id},
            {"$set": {"beds.$.status": "available", "beds.$.tenant_id": None}},
        )
    return {"ok": True, "already_archived": not bool(changed.modified_count)}


@api.post("/owner/tenants/{tenant_id}/reports")
async def owner_create_tenant_report(
    tenant_id: str,
    body: TenantReportBody,
    user: dict = Depends(require_roles("owner")),
):
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant or not await hostel_owned(user, tenant.get("hostel_id")):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    linked_account = None
    if tenant.get("user_id"):
        linked_account = await db.users.find_one(
            {"id": tenant["user_id"], "role": "tenant"},
            {"_id": 0, "id": 1},
        )
    timestamp = now_utc().isoformat()
    identity = "|".join((
        tenant_id,
        body.category,
        body.title.casefold(),
        body.description.casefold(),
        str(body.amount_claimed),
    ))
    duplicate_key = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    if await db.tenant_reports.find_one({"duplicate_key": duplicate_key}, {"_id": 0}):
        raise HTTPException(status.HTTP_409_CONFLICT, "A matching report already exists for this membership")
    report = {
        "id": new_id(),
        "tenant_id": tenant_id,
        "tenant_user_id": linked_account.get("id") if linked_account else None,
        "hostel_id": tenant["hostel_id"],
        "reporter_user_id": user["id"],
        "category": body.category,
        "title": body.title,
        "description": body.description,
        "amount_claimed": body.amount_claimed,
        "outstanding_balance": body.amount_claimed,
        "status": "reported_pending_verification",
        "duplicate_key": duplicate_key,
        "created_at": timestamp,
        "updated_at": timestamp,
        "stay_start_date": tenant.get("joining_date"),
        "vacated_at": tenant.get("checkout_date"),
        "evidence_summary": body.evidence_summary,
    }
    report_hostel = await db.hostels.find_one(
        {"id": tenant["hostel_id"]}, {"_id": 0, "name": 1}
    )
    report["previous_hostel"] = report_hostel.get("name") if report_hostel else None
    try:
        await db.tenant_reports.insert_one(report)
    except DuplicateKeyError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, "A matching report already exists for this membership") from error
    await db.tenant_history_audit.insert_one({
        "id": new_id(),
        "actor_user_id": user["id"],
        "tenant_user_id": linked_account.get("id") if linked_account else None,
        "hostel_id": tenant["hostel_id"],
        "report_id": report["id"],
        "action": "report_created",
        "to_status": "reported_pending_verification",
        "created_at": timestamp,
    })
    await _notify_tenant_report_event(report, "report_submitted", user["id"])
    return {"report": _history_report_summary(report)}


@api.put("/owner/tenant-reports/{report_id}/status")
async def owner_update_tenant_report_status(
    report_id: str,
    body: TenantReportStatusBody,
    user: dict = Depends(require_roles("owner")),
):
    report = await _tenant_report_for_owner(report_id, user)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    before = report.get("status", "reported_pending_verification")
    if before in {"resolved_paid", "rejected"} and body.status != before:
        raise HTTPException(status.HTTP_409_CONFLICT, "Closed reports cannot be reopened")
    allowed_transitions = {
        "reported_pending_verification": {"under_review", "verified_outstanding", "rejected"},
        "under_review": {"verified_outstanding", "rejected"},
        "verified_outstanding": {"under_review", "resolved_paid", "rejected"},
        "disputed_by_tenant": {"under_review", "verified_outstanding", "rejected"},
        "partially_settled": {"under_review", "verified_outstanding", "resolved_paid", "rejected"},
    }
    if body.status != before and body.status not in allowed_transitions.get(before, set()):
        raise HTTPException(status.HTTP_409_CONFLICT, "This report status transition is not allowed")
    if body.status == "resolved_paid" and report.get("outstanding_balance", report.get("amount_claimed", 0)) > 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Record settlements that clear the balance before marking the report resolved")
    timestamp = now_utc().isoformat()
    balance = report.get("outstanding_balance", report.get("amount_claimed", 0))
    write_off = balance if body.status == "rejected" else 0
    report_update = {
        "status": body.status,
        "status_note": body.note,
        "outstanding_balance": balance - write_off,
        "updated_at": timestamp,
    }
    if body.status in {"resolved_paid", "rejected"}:
        report_update["resolved_at"] = timestamp
        report_update["resolution_details"] = body.note or (
            "Outstanding balance paid or settled." if body.status == "resolved_paid"
            else "Report rejected; claimed balance written off."
        )
    changed = await db.tenant_reports.update_one(
        {"id": report_id, "hostel_id": report["hostel_id"], "outstanding_balance": balance},
        {"$set": report_update},
    )
    if changed.matched_count != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "The report changed; refresh before updating its status")
    if write_off:
        try:
            await db.tenant_report_settlements.insert_one({
                "id": new_id(),
                "entry_type": "write_off",
                "report_id": report_id,
                "tenant_id": report["tenant_id"],
                "hostel_id": report["hostel_id"],
                "owner_id": user["id"],
                "amount": write_off,
                "note": body.note or "Report dismissed",
                "created_at": timestamp,
            })
        except Exception:
            await db.tenant_reports.update_one(
                {"id": report_id, "hostel_id": report["hostel_id"], "status": body.status},
                {"$set": {
                    "status": before,
                    "status_note": report.get("status_note"),
                    "outstanding_balance": balance,
                    "updated_at": report.get("updated_at"),
                    "resolved_at": report.get("resolved_at"),
                    "resolution_details": report.get("resolution_details"),
                }},
            )
            raise
    await db.tenant_history_audit.insert_one({
        "actor_user_id": user["id"],
        "tenant_user_id": report.get("tenant_user_id"),
        "hostel_id": report["hostel_id"],
        "id": new_id(),
        "report_id": report_id,
        "action": "status_changed",
        "from_status": before,
        "to_status": body.status,
        "write_off_amount": write_off,
        "note": body.note,
        "created_at": timestamp,
    })
    updated = await db.tenant_reports.find_one({"id": report_id}, {"_id": 0})
    if before != body.status:
        await _notify_tenant_report_event(updated, "report_status_updated", user["id"])
    return {"report": _history_report_summary(updated)}


@api.get("/tenant/global-history/reports")
async def tenant_global_history_reports(user: dict = Depends(require_roles("tenant"))):
    reports = await db.tenant_reports.find(
        {"tenant_user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    result = []
    for report in reports:
        hostel = await db.hostels.find_one(
            {"id": report.get("hostel_id")}, {"_id": 0, "name": 1}
        )
        settlements = await db.tenant_report_settlements.find(
            {"report_id": report["id"]},
            {"_id": 0, "entry_type": 1, "amount": 1, "note": 1, "created_at": 1},
        ).sort("created_at", 1).to_list(500)
        result.append({
            **_history_report_summary({
                **report,
                "previous_hostel": hostel.get("name") if hostel else None,
            }),
            "title": report.get("title"),
            "details": report.get("description"),
            "status_note": report.get("status_note"),
            "settlements": settlements,
        })
    return {"reports": result}


@api.get("/tenant/global-history/reports/{report_id}")
async def tenant_get_global_history_report(
    report_id: str,
    user: dict = Depends(require_roles("tenant")),
):
    report = await db.tenant_reports.find_one(
        {"id": report_id, "tenant_user_id": user["id"]}, {"_id": 0}
    )
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    hostel = await db.hostels.find_one(
        {"id": report.get("hostel_id")}, {"_id": 0, "name": 1}
    )
    return {
        "report": {
            **_history_report_summary({
                **report,
                "previous_hostel": hostel.get("name") if hostel else None,
            }),
            "title": report.get("title"),
            "details": report.get("description"),
            "status_note": report.get("status_note"),
            "resolved_at": report.get("resolved_at"),
            "resolution_details": report.get("resolution_details"),
        }
    }


@api.post("/tenant/global-history/reports/{report_id}/response")
async def tenant_respond_to_global_history_report(
    report_id: str,
    body: TenantReportResponseBody,
    user: dict = Depends(require_roles("tenant")),
):
    report = await db.tenant_reports.find_one({
        "id": report_id,
        "tenant_user_id": user["id"],
    }, {"_id": 0})
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    if report.get("status") in {"resolved_paid", "rejected"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "This report is closed and can no longer be disputed")
    timestamp = now_utc().isoformat()
    before = report.get("status", "reported_pending_verification")
    await db.tenant_reports.update_one(
        {"id": report_id, "tenant_user_id": user["id"]},
        {"$set": {
            "tenant_response": {"text": body.response, "created_at": timestamp},
            "status": "disputed_by_tenant",
            "updated_at": timestamp,
        }},
    )
    await db.tenant_history_audit.insert_one({
        "id": new_id(),
        "actor_user_id": user["id"],
        "tenant_user_id": user["id"],
        "hostel_id": report["hostel_id"],
        "report_id": report_id,
        "action": "tenant_response",
        "response": body.response,
        "from_status": before,
        "to_status": "disputed_by_tenant",
        "created_at": timestamp,
    })
    report.update({"status": "disputed_by_tenant", "tenant_response": {"text": body.response, "created_at": timestamp}})
    await _notify_tenant_report_event(report, "report_disputed", user["id"])
    return {"ok": True, "status": "disputed_by_tenant"}


@api.post("/owner/tenant-reports/{report_id}/settlements")
async def owner_record_tenant_report_settlement(
    report_id: str,
    body: TenantReportSettlementBody,
    user: dict = Depends(require_roles("owner")),
):
    report = await _tenant_report_for_owner(report_id, user)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    if report.get("reporter_user_id") != user["id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    if report.get("status") == "rejected":
        raise HTTPException(status.HTTP_409_CONFLICT, "Rejected reports cannot be settled")
    balance = report.get("outstanding_balance", report.get("amount_claimed", 0))
    if body.amount > balance:
        raise HTTPException(status.HTTP_409_CONFLICT, "Settlement exceeds the outstanding balance")
    timestamp = now_utc().isoformat()
    settlement = {
        "id": new_id(),
        "entry_type": "settlement",
        "report_id": report_id,
        "tenant_id": report["tenant_id"],
        "hostel_id": report["hostel_id"],
        "owner_id": user["id"],
        "amount": body.amount,
        "note": body.note,
        "created_at": timestamp,
    }
    new_balance = balance - body.amount
    new_status = "resolved_paid" if new_balance == 0 else "partially_settled"
    resolved_at = timestamp if new_balance == 0 else report.get("resolved_at")
    resolution_details = (
        body.note or "Outstanding balance paid or settled."
        if new_balance == 0
        else report.get("resolution_details")
    )
    changed = await db.tenant_reports.update_one(
        {"id": report_id, "hostel_id": report["hostel_id"], "outstanding_balance": balance},
        {"$set": {
            "outstanding_balance": new_balance,
            "status": new_status,
            "updated_at": timestamp,
            "resolved_at": resolved_at,
            "resolution_details": resolution_details,
        }},
    )
    if changed.matched_count != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "The report balance changed; refresh before settling")
    try:
        await db.tenant_report_settlements.insert_one(settlement)
    except Exception:
        await db.tenant_reports.update_one(
            {"id": report_id, "hostel_id": report["hostel_id"], "outstanding_balance": new_balance},
            {"$set": {
                "outstanding_balance": balance,
                "status": report.get("status", "reported_pending_verification"),
                "updated_at": report.get("updated_at"),
                "resolved_at": report.get("resolved_at"),
                "resolution_details": report.get("resolution_details"),
            }},
        )
        raise
    await db.tenant_history_audit.insert_one({
        "id": new_id(),
        "actor_user_id": user["id"],
        "tenant_user_id": report.get("tenant_user_id"),
        "hostel_id": report["hostel_id"],
        "report_id": report_id,
        "settlement_id": settlement["id"],
        "action": "settlement_recorded",
        "amount": body.amount,
        "outstanding_balance": new_balance,
        "created_at": timestamp,
    })
    report.update({
        "status": new_status,
        "outstanding_balance": new_balance,
        "updated_at": timestamp,
        "resolved_at": resolved_at,
        "resolution_details": resolution_details,
    })
    await _notify_tenant_report_event(
        report,
        "report_resolved" if new_status == "resolved_paid" else "report_settlement_updated",
        user["id"],
    )
    return {"settlement": clean(settlement), "outstanding_balance": new_balance, "status": new_status}


@api.get("/owner/tenant-history/reports/{report_id}")
async def owner_get_tenant_history_report(
    report_id: str,
    grant_id: Optional[str] = None,
    user: dict = Depends(require_roles("owner")),
):
    report = await _tenant_report_owner_access(report_id, user, grant_id)
    report_details = {
        key: report.get(key) for key in (
            "id", "category", "title", "description", "amount_claimed",
            "outstanding_balance", "status", "status_note", "tenant_response",
            "created_at", "updated_at", "resolved_at", "resolution_details",
        )
    } | {
        "evidence_documents": _history_report_summary(report)["evidence_documents"],
        "previous_hostel": report.get("previous_hostel"),
    }
    report_hostel = await db.hostels.find_one(
        {"id": report.get("hostel_id")}, {"_id": 0, "name": 1}
    )
    if report_hostel:
        report_details["previous_hostel"] = report_hostel.get("name")
    report_details["settlements"] = await db.tenant_report_settlements.find(
        {"report_id": report_id},
        {"_id": 0, "entry_type": 1, "amount": 1, "note": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(500)
    return {"report": report_details}


@api.get("/owner/tenants/{tenant_id}/reports")
async def owner_get_tenant_reports(
    tenant_id: str,
    user: dict = Depends(require_roles("owner")),
):
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant or not await hostel_owned(user, tenant.get("hostel_id")):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    reports = await db.tenant_reports.find(
        {"tenant_id": tenant_id, "hostel_id": tenant["hostel_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    settlements = await db.tenant_report_settlements.find(
        {"report_id": {"$in": [report["id"] for report in reports]}},
        {"_id": 0, "entry_type": 1, "amount": 1, "note": 1, "created_at": 1, "report_id": 1},
    ).sort("created_at", 1).to_list(500 * len(reports)) if reports else []
    settlements_by_report: dict[str, list[dict]] = {}
    for settlement in settlements:
        settlements_by_report.setdefault(settlement["report_id"], []).append({
            key: value for key, value in settlement.items() if key != "report_id"
        })
    report_results = []
    for report in reports:
        report_results.append({
            **_history_report_summary(report),
            "title": report.get("title"),
            "status_note": report.get("status_note"),
            "tenant_response": report.get("tenant_response"),
            "settlements": settlements_by_report.get(report["id"], []),
        })
    return {"reports": report_results}


# Rent
class RentBody(BaseModel):
    tenant_id: str
    amount: int
    type: Literal["rent", "advance", "deposit"] = "rent"
    method: str = "cash"
    note: Optional[str] = None


def _receipt_no() -> str:
    return "RCPT-" + now_utc().strftime("%y%m") + "-" + new_id().upper()


@api.get("/owner/rent")
async def owner_rent(hostel_id: Optional[str] = None, user: dict = Depends(require_roles("owner"))):
    h = await get_owner_hostel(user, hostel_id)
    if not h:
        return {"payments": [], "tenants": []}
    payments = await db.payments.find({"hostel_id": h["id"]}, {"_id": 0}).sort("date", -1).to_list(5000)
    pending_payments = await db.payments.find(
        {
            "hostel_id": h["id"],
            "status": {"$in": ["pending_owner_approval", "approval_processing"]},
        },
        {"_id": 0},
    ).sort("created_at", 1).to_list(1000)
    tenants = await db.tenants.find({"hostel_id": h["id"], "active": True}, {"_id": 0}).to_list(2000)
    return {"payments": payments, "pending_payments": pending_payments, "tenants": tenants}


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
        balance = max(0, _rent_balance(t) - body.amount)
        await db.tenants.update_one({"id": body.tenant_id}, {"$set": {
            "rent_balance": balance,
            "payment_status": "paid" if balance == 0 else "due",
            "last_paid": now_utc().isoformat(),
        }})
    return {"payment": clean(doc)}


class TenantRentPaymentBody(BaseModel):
    amount: int = Field(gt=0, le=10_000_000)
    payment_date: date
    upi_reference: str = Field(min_length=6, max_length=80)
    method: Literal["phonepe", "google_pay", "paytm", "other_upi"]
    screenshot_data: Optional[str] = Field(default=None, max_length=4_200_000)
    screenshot_name: Optional[str] = Field(default=None, max_length=160)
    screenshot_content_type: Optional[Literal["image/jpeg", "image/png", "image/webp"]] = None

    @field_validator("payment_date")
    @classmethod
    def validate_payment_date(cls, value: date) -> date:
        if value > now_utc().astimezone(ZoneInfo("Asia/Kolkata")).date():
            raise ValueError("Payment date cannot be in the future")
        return value

    @field_validator("upi_reference")
    @classmethod
    def validate_upi_reference(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9-]{6,80}", value):
            raise ValueError("Enter a valid UPI transaction/reference ID")
        return value

    @model_validator(mode="after")
    def validate_screenshot(self):
        if self.screenshot_data is None:
            if self.screenshot_name or self.screenshot_content_type:
                raise ValueError("Screenshot details require a screenshot")
            return self
        if not self.screenshot_name or not self.screenshot_content_type:
            raise ValueError("Screenshot filename and image type are required")
        if not re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+", self.screenshot_data):
            raise ValueError("Upload a valid JPG, PNG, or WebP screenshot")
        return self


def _rent_balance(tenant: dict) -> int:
    if tenant.get("rent_balance") is not None:
        return max(0, int(tenant["rent_balance"]))
    return max(0, int(tenant.get("monthly_rent", 0))) if tenant.get("payment_status") == "due" else 0


def _rent_evidence_path(evidence: dict) -> Path:
    evidence_id = evidence.get("id", "")
    extension = evidence.get("extension", "")
    if not re.fullmatch(r"[0-9a-f]{32}", evidence_id) or extension not in {"jpg", "png", "webp"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment screenshot not found")
    return TENANT_RENT_EVIDENCE_DIR / f"{evidence_id}.{extension}.enc"


async def _save_rent_evidence(body: TenantRentPaymentBody, tenant: dict, user: dict) -> Optional[dict]:
    if body.screenshot_data is None:
        return None
    cipher = _tenant_document_cipher()
    content_type = body.screenshot_content_type
    extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[content_type]
    try:
        raw = base64.b64decode(body.screenshot_data.split(",", 1)[1], validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise HTTPException(400, "Payment screenshot data is invalid") from error
    signatures = {
        "image/jpeg": raw.startswith(b"\xff\xd8\xff"),
        "image/png": raw.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP",
    }
    if not raw or len(raw) > TENANT_RENT_EVIDENCE_MAX_SIZE or not signatures[content_type]:
        raise HTTPException(400, "The payment screenshot is invalid or exceeds 3 MB")
    try:
        with Image.open(BytesIO(raw)) as image:
            if image.width * image.height > 40_000_000:
                raise HTTPException(413, "Payment screenshot dimensions are too large")
            image.verify()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(400, "The payment screenshot is invalid") from error

    evidence_id = new_id()
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(body.screenshot_name or f"payment.{extension}").name)[:160]
    TENANT_RENT_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    path = TENANT_RENT_EVIDENCE_DIR / f"{evidence_id}.{extension}.enc"
    evidence = {
        "id": evidence_id,
        "tenant_id": tenant["id"],
        "tenant_user_id": user["id"],
        "hostel_id": tenant["hostel_id"],
        "filename": safe_name or f"payment.{extension}",
        "content_type": content_type,
        "extension": extension,
        "size": len(raw),
        "created_at": now_utc().isoformat(),
    }
    try:
        encrypted = await asyncio.to_thread(cipher.encrypt, raw)
        await asyncio.to_thread(path.write_bytes, encrypted)
        await db.rent_payment_evidence.insert_one(evidence)
    except Exception:
        if path.is_file():
            path.unlink()
        raise
    return evidence


async def _notify_rent_payment(payment: dict, event: str, actor_user_id: str):
    tenant_message = {
        "rent_payment_submitted": "Your UPI rent payment was submitted for owner approval.",
        "rent_payment_approved": "Your UPI rent payment was approved and a receipt is ready.",
        "rent_payment_rejected": f"Your UPI rent payment was rejected: {payment.get('rejection_reason', '')}",
    }.get(event, "Rent payment status updated.")
    owner_message = {
        "rent_payment_submitted": f"{payment.get('tenant_name') or 'A tenant'} submitted a UPI rent payment for approval.",
        "rent_payment_approved": f"The UPI rent payment from {payment.get('tenant_name') or 'the tenant'} was approved.",
        "rent_payment_rejected": f"The UPI rent payment from {payment.get('tenant_name') or 'the tenant'} was rejected.",
    }.get(event, "Rent payment status updated.")
    owner_recipient = (payment.get("owner_user_id"), "owner")
    tenant_recipient = (payment.get("tenant_user_id"), "tenant")
    if event == "rent_payment_submitted":
        recipients = {owner_recipient, tenant_recipient}
    else:
        recipients = {tenant_recipient}
    records = [{
        "id": new_id(),
        "recipient_user_id": recipient_id,
        "recipient_role": role,
        "hostel_id": payment["hostel_id"],
        "actor_user_id": actor_user_id,
        "payment_id": payment["id"],
        "event": event,
        "message": owner_message if role == "owner" else tenant_message,
        "amount": payment["amount"],
        "tenant_name": payment.get("tenant_name"),
        "room_number": payment.get("room_number"),
        "method": payment.get("method"),
        "upi_reference": payment.get("upi_reference"),
        "payment_submitted_at": payment.get("created_at"),
        "status": payment.get("status"),
        "rejection_reason": payment.get("rejection_reason"),
        "created_at": now_utc().isoformat(),
        "read_at": None,
    } for recipient_id, role in recipients if recipient_id]
    if event != "rent_payment_submitted" and payment.get("owner_user_id"):
        await db.tenant_history_notifications.update_one(
            {
                "payment_id": payment["id"],
                "recipient_user_id": payment["owner_user_id"],
                "recipient_role": "owner",
                "event": "rent_payment_submitted",
            },
            {"$set": {
                "event": event,
                "message": owner_message,
                "status": payment.get("status"),
                "rejection_reason": payment.get("rejection_reason"),
                "updated_at": now_utc().isoformat(),
            }},
        )
    if records:
        await db.tenant_history_notifications.insert_many(records, ordered=False)


@api.post("/tenant/rent-payment")
async def tenant_submit_rent_payment(
    body: TenantRentPaymentBody,
    user: dict = Depends(require_roles("tenant")),
):
    tenant = await _tenant_record(user)
    if not tenant:
        raise HTTPException(400, "No active allocation")
    hostel = await db.hostels.find_one(
        {"id": tenant["hostel_id"]}, {"_id": 0, "upi_id": 1, "upi_qr_code": 1, "owner_id": 1}
    )
    if not hostel or not (hostel.get("upi_id") or hostel.get("upi_qr_code")):
        raise HTTPException(409, "The hostel owner has not configured UPI payment details")
    if await db.payments.find_one({
        "tenant_id": tenant["id"],
        "status": {"$in": ["pending_owner_approval", "approval_processing"]},
    }, {"_id": 0, "id": 1}):
        raise HTTPException(409, "A rent payment is already awaiting owner approval")
    balance = _rent_balance(tenant)
    if balance <= 0:
        raise HTTPException(409, "There is no rent balance due")
    if body.amount > balance:
        raise HTTPException(400, f"Amount cannot exceed the outstanding rent of ₹{balance}")
    room = await db.rooms.find_one(
        {"id": tenant.get("room_id"), "hostel_id": tenant["hostel_id"]},
        {"_id": 0, "room_number": 1},
    ) if tenant.get("room_id") else None
    duplicate = await db.payments.find_one({
        "tenant_id": tenant["id"],
        "upi_reference": body.upi_reference,
    }, {"_id": 0})
    if duplicate:
        raise HTTPException(409, "This UPI transaction/reference ID was already submitted")

    evidence = await _save_rent_evidence(body, tenant, user)
    payment = {
        "id": new_id(),
        "hostel_id": tenant["hostel_id"],
        "tenant_id": tenant["id"],
        "tenant_user_id": user["id"],
        "tenant_name": tenant["name"],
        "room_number": tenant.get("room_number") or (room or {}).get("room_number"),
        "owner_user_id": hostel.get("owner_id"),
        "amount": body.amount,
        "type": "rent",
        "method": body.method,
        "upi_reference": body.upi_reference,
        "evidence_id": evidence["id"] if evidence else None,
        "status": "pending_owner_approval",
        "date": body.payment_date.isoformat(),
        "created_at": now_utc().isoformat(),
    }
    try:
        await db.payments.insert_one(payment)
    except DuplicateKeyError as error:
        if evidence:
            evidence_path = _rent_evidence_path(evidence)
            if evidence_path.is_file():
                evidence_path.unlink()
            await db.rent_payment_evidence.delete_one({"id": evidence["id"]})
        raise HTTPException(409, "This UPI transaction/reference ID was already submitted") from error
    await db.tenant_history_audit.insert_one({
        "id": new_id(),
        "actor_user_id": user["id"],
        "tenant_user_id": user["id"],
        "hostel_id": tenant["hostel_id"],
        "payment_id": payment["id"],
        "action": "rent_payment_submitted",
        "created_at": now_utc().isoformat(),
    })
    await _notify_rent_payment(payment, "rent_payment_submitted", user["id"])
    return {"payment": clean(payment)}


@api.get("/owner/rent/{payment_id}/evidence")
async def owner_get_rent_payment_evidence(payment_id: str, user: dict = Depends(require_roles("owner"))):
    payment = await db.payments.find_one({"id": payment_id, "type": "rent"}, {"_id": 0})
    if not payment or not await hostel_owned(user, payment.get("hostel_id")):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    evidence = await db.rent_payment_evidence.find_one({
        "id": payment.get("evidence_id"),
        "hostel_id": payment["hostel_id"],
    }, {"_id": 0})
    if not evidence:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment screenshot not found")
    path = _rent_evidence_path(evidence)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment screenshot is unavailable")
    try:
        content = await asyncio.to_thread(
            _tenant_document_cipher().decrypt, await asyncio.to_thread(path.read_bytes)
        )
    except InvalidToken as error:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Payment screenshot could not be decrypted") from error
    return Response(content, media_type=evidence["content_type"], headers={
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'attachment; filename="{evidence["filename"]}"',
    })


@api.post("/owner/rent/{payment_id}/approve")
async def owner_approve_rent_payment(payment_id: str, user: dict = Depends(require_roles("owner"))):
    payment = await db.payments.find_one({"id": payment_id, "type": "rent"}, {"_id": 0})
    if not payment or not await hostel_owned(user, payment.get("hostel_id")):
        raise HTTPException(404, "Payment not found")
    if payment.get("status") == "paid":
        return {"payment": clean(payment), "already_approved": True}
    if payment.get("status") not in {"pending_owner_approval", "approval_processing"}:
        raise HTTPException(409, "This payment is no longer awaiting approval")
    if payment.get("status") == "pending_owner_approval":
        claim = await db.payments.update_one(
            {"id": payment_id, "status": "pending_owner_approval"},
            {"$set": {"status": "approval_processing", "approved_by": user["id"]}},
        )
        if claim.matched_count != 1:
            raise HTTPException(409, "This payment is already being processed")
        payment["status"] = "approval_processing"

    tenant = await db.tenants.find_one({"id": payment["tenant_id"], "hostel_id": payment["hostel_id"]}, {"_id": 0})
    if not tenant:
        await db.payments.update_one(
            {"id": payment_id, "status": "approval_processing"},
            {"$set": {"status": "pending_owner_approval"}, "$unset": {"approved_by": ""}},
        )
        raise HTTPException(404, "Tenant not found")
    if tenant.get("rent_balance") is None:
        await db.tenants.update_one(
            {"id": tenant["id"], "rent_balance": {"$exists": False}},
            {"$set": {"rent_balance": _rent_balance(tenant)}},
        )
        tenant = await db.tenants.find_one({"id": tenant["id"]}, {"_id": 0})
    balance = max(0, int(tenant.get("rent_balance", 0)))
    if payment["amount"] > balance:
        await db.payments.update_one(
            {"id": payment_id, "status": "approval_processing"},
            {"$set": {"status": "pending_owner_approval"}, "$unset": {"approved_by": ""}},
        )
        raise HTTPException(409, "The amount exceeds the current outstanding rent; review the balance before approving")

    approved_at = now_utc().isoformat()
    applied = await db.tenants.update_one(
        {
            "id": tenant["id"],
            "applied_rent_payment_ids": {"$ne": payment_id},
            "rent_balance": {"$gte": payment["amount"]},
        },
        {
            "$inc": {"rent_balance": -payment["amount"]},
            "$addToSet": {"applied_rent_payment_ids": payment_id},
            "$set": {"last_paid": approved_at},
        },
    )
    refreshed_tenant = await db.tenants.find_one({"id": tenant["id"]}, {"_id": 0})
    if applied.matched_count == 0 and payment_id not in refreshed_tenant.get("applied_rent_payment_ids", []):
        await db.payments.update_one(
            {"id": payment_id, "status": "approval_processing"},
            {"$set": {"status": "pending_owner_approval"}, "$unset": {"approved_by": ""}},
        )
        raise HTTPException(409, "The amount exceeds the current outstanding rent; review the balance before approving")
    current_balance = max(0, int(refreshed_tenant.get("rent_balance", 0)))
    receipt_no = payment.get("receipt_no") or _receipt_no()
    final_payment = {
        "status": "paid",
        "receipt_no": receipt_no,
        "approved_at": approved_at,
        "approved_by": user["id"],
        "balance_applied": True,
        "outstanding_after": current_balance,
    }
    await db.payments.update_one({"id": payment_id, "status": "approval_processing"}, {"$set": final_payment})
    await db.tenants.update_one(
        {"id": tenant["id"]},
        {"$set": {"payment_status": "paid" if current_balance == 0 else "due"}},
    )
    payment.update(final_payment)
    await db.tenant_history_audit.insert_one({
        "id": new_id(),
        "actor_user_id": user["id"],
        "tenant_user_id": payment.get("tenant_user_id"),
        "hostel_id": payment["hostel_id"],
        "payment_id": payment_id,
        "action": "rent_payment_approved",
        "amount": payment["amount"],
        "outstanding_balance": current_balance,
        "created_at": approved_at,
    })
    await _notify_rent_payment(payment, "rent_payment_approved", user["id"])
    return {"payment": clean(payment), "already_approved": applied.matched_count == 0}


class RejectRentPaymentBody(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("reason")
    @classmethod
    def trim_rejection_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A rejection reason is required")
        return value


@api.post("/owner/rent/{payment_id}/reject")
async def owner_reject_rent_payment(
    payment_id: str,
    body: RejectRentPaymentBody,
    user: dict = Depends(require_roles("owner")),
):
    payment = await db.payments.find_one({"id": payment_id, "type": "rent"}, {"_id": 0})
    if not payment or not await hostel_owned(user, payment.get("hostel_id")):
        raise HTTPException(404, "Payment not found")
    rejected_at = now_utc().isoformat()
    changed = await db.payments.update_one(
        {"id": payment_id, "status": "pending_owner_approval"},
        {"$set": {
            "status": "rejected",
            "rejection_reason": body.reason,
            "rejected_at": rejected_at,
            "rejected_by": user["id"],
        }},
    )
    if changed.matched_count != 1:
        raise HTTPException(409, "This payment is no longer awaiting approval")
    payment.update({
        "status": "rejected",
        "rejection_reason": body.reason,
        "rejected_at": rejected_at,
        "rejected_by": user["id"],
    })
    await db.tenant_history_audit.insert_one({
        "id": new_id(),
        "actor_user_id": user["id"],
        "tenant_user_id": payment.get("tenant_user_id"),
        "hostel_id": payment["hostel_id"],
        "payment_id": payment_id,
        "action": "rent_payment_rejected",
        "reason": body.reason,
        "created_at": rejected_at,
    })
    await _notify_rent_payment(payment, "rent_payment_rejected", user["id"])
    return {"payment": clean(payment)}


# Expenses
DEFAULT_EXPENSE_CATEGORY_NAMES = {
    "electricity", "water", "internet", "gas", "staff salary", "food",
    "maintenance", "repairs", "other",
}


def _normalized_expense_category_name(name: str) -> str:
    return name.strip().casefold()


def _expense_purpose(expense: dict) -> str:
    purpose = expense.get("purpose")
    return purpose if purpose in {"property", "personal"} else "unclassified"


class ExpenseCategoryBody(BaseModel):
    hostel_id: Optional[str] = None
    name: str = Field(min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=240)
    purpose: Literal["property", "personal"]

    @field_validator("name")
    @classmethod
    def trim_category_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Category name is required")
        return value

    @field_validator("description")
    @classmethod
    def trim_category_description(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() or None if value is not None else None


class ExpenseBody(BaseModel):
    hostel_id: Optional[str] = None
    category: str = Field(min_length=1, max_length=60)
    purpose: Optional[Literal["property", "personal"]] = None
    amount: int
    note: Optional[str] = None
    date: Optional[str] = None

    @field_validator("category")
    @classmethod
    def trim_expense_category(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Expense category is required")
        return value


@api.get("/owner/expense-categories")
async def owner_get_expense_categories(
    hostel_id: Optional[str] = None,
    user: dict = Depends(require_roles("owner")),
):
    hostel = await get_owner_hostel(user, hostel_id)
    if not hostel:
        return {"categories": []}
    categories = await db.expense_categories.find(
        {"owner_id": user["id"], "hostel_id": hostel["id"]},
        {"_id": 0},
    ).sort("name", 1).to_list(500)
    return {"categories": categories}


@api.post("/owner/expense-categories")
async def owner_add_expense_category(
    body: ExpenseCategoryBody,
    user: dict = Depends(require_roles("owner")),
):
    hostel = await get_owner_hostel(user, body.hostel_id)
    if not hostel:
        raise HTTPException(400, "Create your hostel first")

    normalized_name = _normalized_expense_category_name(body.name)
    if normalized_name in DEFAULT_EXPENSE_CATEGORY_NAMES:
        raise HTTPException(409, "This category already exists")
    scope = {"owner_id": user["id"], "hostel_id": hostel["id"]}
    if await db.expense_categories.find_one({**scope, "normalized_name": normalized_name}):
        raise HTTPException(409, "A category with this name already exists for this property")

    category = {
        "id": new_id(),
        **scope,
        "name": body.name,
        "description": body.description,
        "purpose": body.purpose,
        "normalized_name": normalized_name,
        "created_at": now_utc().isoformat(),
    }
    try:
        await db.expense_categories.insert_one(category)
    except DuplicateKeyError as error:
        raise HTTPException(409, "A category with this name already exists for this property") from error
    return {"category": clean(category)}


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
    if body.category not in {
        "electricity", "water", "internet", "gas", "staff_salary", "food",
        "maintenance", "repairs", "other",
    }:
        custom_category = await db.expense_categories.find_one({
            "owner_id": user["id"],
            "hostel_id": h["id"],
            "normalized_name": _normalized_expense_category_name(body.category),
        })
        if not custom_category:
            raise HTTPException(400, "Select a valid expense category for this property")
        category_name = custom_category["name"]
        category_purpose = custom_category.get("purpose")
    else:
        category_name = body.category
        category_purpose = "property"
    purpose = body.purpose or category_purpose
    if purpose is None:
        raise HTTPException(400, "Select a purpose for this expense")
    doc = {
        "id": new_id(),
        "owner_id": user["id"],
        "hostel_id": h["id"],
        "category": category_name,
        "purpose": purpose,
        "amount": body.amount,
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
    rooms = await db.rooms.find({"hostel_id": h["id"]}, {"_id": 0}).to_list(None)
    tenants = await db.tenants.find({"hostel_id": h["id"], "active": True}, {"_id": 0}).to_list(2000)
    bed_counts = _room_bed_counts(rooms)
    total_beds = bed_counts["total"]
    occupied = bed_counts["occupied"]
    total_collection = sum(p.get("amount", 0) for p in payments)
    property_expenses = [e for e in expenses if _expense_purpose(e) == "property"]
    personal_expenses = [e for e in expenses if _expense_purpose(e) == "personal"]
    unclassified_expenses = [e for e in expenses if _expense_purpose(e) == "unclassified"]
    total_expenses = sum(e.get("amount", 0) for e in property_expenses)
    total_personal_expenses = sum(e.get("amount", 0) for e in personal_expenses)
    total_unclassified_expenses = sum(e.get("amount", 0) for e in unclassified_expenses)
    # monthly breakdown last 6 months
    months = {}
    for p in payments:
        k = (p.get("date") or "")[:7]
        months.setdefault(k, {"collection": 0, "expense": 0})
        months[k]["collection"] += p.get("amount", 0)
    for e in property_expenses:
        k = (e.get("date") or "")[:7]
        months.setdefault(k, {"collection": 0, "expense": 0})
        months[k]["expense"] += e.get("amount", 0)
    for e in personal_expenses:
        k = (e.get("date") or "")[:7]
        months.setdefault(k, {"collection": 0, "expense": 0, "personal_expense": 0})
        months[k]["personal_expense"] = months[k].get("personal_expense", 0) + e.get("amount", 0)
    for e in unclassified_expenses:
        k = (e.get("date") or "")[:7]
        months.setdefault(k, {"collection": 0, "expense": 0, "unclassified_expense": 0})
        months[k]["unclassified_expense"] = months[k].get("unclassified_expense", 0) + e.get("amount", 0)
    for month in months.values():
        month.setdefault("personal_expense", 0)
        month.setdefault("unclassified_expense", 0)
    monthly = [{"month": k, **v, "profit": v["collection"] - v["expense"]} for k, v in sorted(months.items())][-6:]
    # expense by category
    by_cat = {}
    for e in property_expenses:
        by_cat[e["category"]] = by_cat.get(e["category"], 0) + e.get("amount", 0)
    personal_by_cat = {}
    for e in personal_expenses:
        personal_by_cat[e["category"]] = personal_by_cat.get(e["category"], 0) + e.get("amount", 0)
    unclassified_by_cat = {}
    for e in unclassified_expenses:
        unclassified_by_cat[e["category"]] = unclassified_by_cat.get(e["category"], 0) + e.get("amount", 0)
    return {
        "has_hostel": True,
        "total_collection": round(total_collection, 2),
        "total_expenses": round(total_expenses, 2),
        "personal_expenses": round(total_personal_expenses, 2),
        "unclassified_expenses": round(total_unclassified_expenses, 2),
        "net_profit": round(total_collection - total_expenses, 2),
        "occupancy_pct": round((occupied / total_beds * 100), 0) if total_beds else 0,
        "available_beds": bed_counts["available"],
        "total_beds": total_beds,
        "rent_due_count": len([t for t in tenants if t.get("payment_status") == "due"]),
        "rent_due_amount": sum(t.get("monthly_rent", 0) for t in tenants if t.get("payment_status") == "due"),
        "monthly": monthly,
        "expense_by_category": by_cat,
        "personal_expense_by_category": personal_by_cat,
        "unclassified_expense_by_category": unclassified_by_cat,
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


@api.delete("/owner/notices/{notice_id}")
async def owner_delete_notice(notice_id: str, user: dict = Depends(require_roles("owner"))):
    notice = await db.notices.find_one({"id": notice_id}, {"_id": 0})
    if not notice:
        raise HTTPException(404, "Notice not found")
    hostel = await get_owner_hostel(user, notice.get("hostel_id"))
    if not hostel:
        raise HTTPException(404, "Notice not found")
    result = await db.notices.delete_one({"id": notice_id, "hostel_id": hostel["id"]})
    if result.deleted_count != 1:
        raise HTTPException(404, "Notice not found")
    return {"ok": True}


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


# ---------------- Hostel rules and acknowledgements ----------------
RULE_IMAGE_FORMATS = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}


class RulesDraftBody(BaseModel):
    hostel_id: str
    text: str = Field(max_length=50000)
    source_image_ids: list[str] = Field(default_factory=list, max_length=RULE_IMAGES_MAX_COUNT)

    @field_validator("text")
    @classmethod
    def validate_rules_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Add rules text before saving")
        return value

    @field_validator("source_image_ids")
    @classmethod
    def validate_rules_image_ids(cls, value: list[str]) -> list[str]:
        if any(not re.fullmatch(r"[0-9a-f]{32}", item) for item in value):
            raise ValueError("Invalid rules image reference")
        if len(set(value)) != len(value):
            raise ValueError("A rules image may only be included once")
        return value


class RulesOcrBody(BaseModel):
    hostel_id: str
    upload_ids: list[str] = Field(min_length=1, max_length=RULE_IMAGES_MAX_COUNT)

    @field_validator("upload_ids")
    @classmethod
    def validate_upload_ids(cls, value: list[str]) -> list[str]:
        if any(not re.fullmatch(r"[0-9a-f]{32}", item) for item in value):
            raise ValueError("Invalid rules image reference")
        if len(set(value)) != len(value):
            raise ValueError("A rules image may only be included once")
        return value


class RulesAcknowledgeBody(BaseModel):
    policy_id: str = Field(min_length=1, max_length=64)


def _rules_image_cipher() -> Fernet:
    if not TENANT_DOCUMENT_ENCRYPTION_KEY:
        raise HTTPException(
            503,
            "Private image storage is not configured. Set TENANT_DOCUMENT_ENCRYPTION_KEY before uploading rules images.",
        )
    try:
        return Fernet(TENANT_DOCUMENT_ENCRYPTION_KEY.encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        raise HTTPException(503, "Private image encryption configuration is invalid")


def _rules_image_path(image: dict) -> Path:
    image_id = image.get("id", "")
    extension = image.get("extension", "")
    if not re.fullmatch(r"[0-9a-f]{32}", image_id) or extension not in {"jpg", "png", "webp"}:
        raise HTTPException(404, "Rules image not found")
    return RULE_IMAGE_DIR / f"{image_id}.{extension}.enc"


async def _latest_rules_policy(hostel_id: str) -> Optional[dict]:
    policies = await db.rules_policies.find(
        {"hostel_id": hostel_id, "status": "published"},
        {"_id": 0},
    ).sort("version", -1).to_list(1)
    return policies[0] if policies else None


async def _owned_rules_uploads(upload_ids: list[str], hostel_id: str, owner_id: str) -> list[dict]:
    uploads = []
    for upload_id in upload_ids:
        image = await db.rules_image_uploads.find_one({
            "id": upload_id,
            "hostel_id": hostel_id,
            "owner_id": owner_id,
        })
        if not image or not _rules_image_path(image).is_file():
            raise HTTPException(400, "A rules image is missing or no longer available; upload it again")
        uploads.append(image)
    return uploads


async def _save_rules_draft(hostel_id: str, owner_id: str, text: str, source_image_ids: list[str]) -> dict:
    timestamp = now_utc().isoformat()
    await db.rule_drafts.update_one(
        {"hostel_id": hostel_id, "owner_id": owner_id},
        {
            "$set": {
                "hostel_id": hostel_id,
                "owner_id": owner_id,
                "text": text,
                "source_image_ids": source_image_ids,
                "updated_at": timestamp,
            },
            "$setOnInsert": {"created_at": timestamp},
        },
        upsert=True,
    )
    return await db.rule_drafts.find_one(
        {"hostel_id": hostel_id, "owner_id": owner_id},
        {"_id": 0},
    )


@api.post("/owner/rules/images")
async def upload_rules_image(
    hostel_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("owner")),
):
    hostel = await get_owner_hostel(user, hostel_id)
    if not hostel:
        raise HTTPException(404, "Hostel not found")
    cipher = _rules_image_cipher()
    content = bytearray()
    try:
        while chunk := await file.read(1024 * 1024):
            content.extend(chunk)
            if len(content) > RULE_IMAGE_MAX_SIZE:
                raise HTTPException(413, "Each rules image must be 10 MB or smaller")
    finally:
        await file.close()

    raw = bytes(content)
    if not raw:
        raise HTTPException(400, "The selected image is empty")
    try:
        with Image.open(BytesIO(raw)) as image:
            image_format = image.format
            if image.width * image.height > RULE_IMAGE_MAX_PIXELS:
                raise HTTPException(413, "The selected image dimensions are too large")
            image.verify()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        raise HTTPException(400, "Choose a valid JPG, PNG, or WebP image")
    format_info = RULE_IMAGE_FORMATS.get(image_format or "")
    if not format_info:
        raise HTTPException(400, "Choose a JPG, PNG, or WebP image")
    content_type, extension = format_info
    claimed_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if claimed_type and claimed_type != content_type:
        raise HTTPException(400, "The selected image format does not match its file type")

    image_id = new_id()
    path = RULE_IMAGE_DIR / f"{image_id}.{extension}.enc"
    metadata = {
        "id": image_id,
        "owner_id": user["id"],
        "hostel_id": hostel["id"],
        "content_type": content_type,
        "extension": extension,
        "size": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "created_at": now_utc().isoformat(),
    }
    try:
        RULE_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        encrypted = await asyncio.to_thread(cipher.encrypt, raw)
        await asyncio.to_thread(path.write_bytes, encrypted)
        await db.rules_image_uploads.insert_one(metadata)
    except Exception:
        if path.is_file():
            path.unlink()
        raise
    return {
        "upload_id": image_id,
        "content_type": content_type,
        "size": len(raw),
        "created_at": metadata["created_at"],
    }


@api.delete("/owner/rules/images/{upload_id}")
async def delete_rules_image(upload_id: str, user: dict = Depends(require_roles("owner"))):
    image = await db.rules_image_uploads.find_one({"id": upload_id, "owner_id": user["id"]})
    if not image:
        return {"ok": True}
    if await db.rules_policies.find_one({"hostel_id": image["hostel_id"], "source_image_ids": upload_id}):
        raise HTTPException(409, "This image is part of a published rules version and cannot be removed")
    await db.rule_drafts.update_one(
        {"hostel_id": image["hostel_id"], "owner_id": user["id"]},
        {"$pull": {"source_image_ids": upload_id}},
    )
    path = _rules_image_path(image)
    result = await db.rules_image_uploads.delete_one({"id": upload_id, "owner_id": user["id"]})
    if result.deleted_count and path.is_file():
        path.unlink()
    return {"ok": True}


@api.get("/owner/rules/images/{upload_id}")
async def view_rules_image(upload_id: str, user: dict = Depends(require_roles("owner"))):
    image = await db.rules_image_uploads.find_one({"id": upload_id, "owner_id": user["id"]})
    if not image or not await hostel_owned(user, image["hostel_id"]):
        raise HTTPException(404, "Rules image not found")
    try:
        encrypted = await asyncio.to_thread(_rules_image_path(image).read_bytes)
        raw = await asyncio.to_thread(_rules_image_cipher().decrypt, encrypted)
    except FileNotFoundError:
        raise HTTPException(404, "Rules image is no longer available")
    except InvalidToken:
        raise HTTPException(500, "The stored rules image could not be read")
    return Response(
        content=raw,
        media_type=image["content_type"],
        headers={"Cache-Control": "private, no-store"},
    )


def _otsu_threshold(image: Image.Image) -> int:
    histogram = image.histogram()
    total = sum(histogram)
    weighted_total = sum(index * count for index, count in enumerate(histogram))
    background_weight = 0
    background_sum = 0
    max_variance = -1.0
    threshold = 0
    for value, count in enumerate(histogram):
        background_weight += count
        if not background_weight:
            continue
        foreground_weight = total - background_weight
        if not foreground_weight:
            break
        background_sum += value * count
        background_mean = background_sum / background_weight
        foreground_mean = (weighted_total - background_sum) / foreground_weight
        variance = background_weight * foreground_weight * (background_mean - foreground_mean) ** 2
        if variance > max_variance:
            max_variance = variance
            threshold = value
    return threshold


def _prepare_rules_ocr_images(raw: bytes) -> list[bytes]:
    try:
        with Image.open(BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "A stored rules image could not be decoded. Upload it again.")

    image.thumbnail((3072, 3072), Image.Resampling.LANCZOS)
    normalized = BytesIO()
    image.save(normalized, format="PNG", optimize=True)

    grayscale = ImageOps.grayscale(image)
    enhanced = ImageOps.autocontrast(grayscale, cutoff=1)
    enhanced = ImageEnhance.Contrast(enhanced).enhance(1.5)
    enhanced = enhanced.filter(ImageFilter.UnsharpMask(radius=1.2, percent=140, threshold=3))
    enhanced_buffer = BytesIO()
    enhanced.save(enhanced_buffer, format="PNG", optimize=True)

    variants = [normalized.getvalue(), enhanced_buffer.getvalue()]
    threshold = _otsu_threshold(enhanced)
    if 32 <= threshold <= 223:
        binary = enhanced.point(lambda value: 255 if value > threshold else 0)
        binary_buffer = BytesIO()
        binary.save(binary_buffer, format="PNG", optimize=True)
        variants.append(binary_buffer.getvalue())
    return variants


async def _request_rules_ocr(images: list[tuple[str, bytes]]) -> dict:
    if not RULES_OCR_API_KEY:
        raise HTTPException(
            503,
            "Rules OCR is not configured. Set GOOGLE_GENAI_API_KEY on the backend and try again.",
        )
    endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{RULES_OCR_MODEL}:generateContent"
    )
    extracted_pages = []
    uncertain_sections = []
    prompt = (
        "Perform OCR on one page of hostel/PG rules. The attached images are alternate, processed "
        "views of the SAME original page; compare them, do not transcribe duplicate versions. "
        "Transcribe every visible printed line in its original reading order. Support English and "
        "Telugu; preserve Telugu in Telugu script. This is transcription, not summarization, "
        "translation, correction, or rewriting. Preserve all exact wording, spelling, punctuation, "
        "headings, paragraphs, bullets, and numbering. Never omit a line, amount, currency symbol, "
        "date, phone number, meal time, or rule. Do not infer unreadable text: write [unclear] in its "
        "place and describe that location in uncertain_sections. If the page appears to contain text "
        "that cannot be read or may have been missed, identify it as uncertain rather than silently "
        "returning a partial transcription. Return only valid JSON with exactly these keys: "
        '{"text": "verbatim transcription", "uncertain_sections": ["location or short excerpt"]}. '
        "If no text is legible, return an empty text string and explain the uncertainty."
    )

    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
        for page_number, (_, raw) in enumerate(images, start=1):
            variants = await asyncio.to_thread(_prepare_rules_ocr_images, raw)
            parts = [{"text": prompt}]
            for image_bytes in variants:
                parts.append({
                    "inlineData": {
                        "mimeType": "image/png",
                        "data": base64.b64encode(image_bytes).decode("ascii"),
                    }
                })
            try:
                response = await client.post(
                    endpoint,
                    headers={"x-goog-api-key": RULES_OCR_API_KEY},
                    json={
                        "contents": [{"parts": parts}],
                        "generationConfig": {
                            "temperature": 0,
                            "maxOutputTokens": 8192,
                            "responseMimeType": "application/json",
                        },
                    },
                )
            except httpx.TimeoutException:
                raise HTTPException(504, f"Text extraction timed out on image {page_number}. Retry.")
            except httpx.RequestError:
                raise HTTPException(502, f"Could not extract text from image {page_number}. Please retry.")
            if response.status_code >= 400:
                raise HTTPException(502, f"Text extraction failed on image {page_number}. Please retry.")
            try:
                candidates = response.json().get("candidates") or []
                candidate = candidates[0]
                finish_reason = candidate.get("finishReason")
                if finish_reason and finish_reason != "STOP":
                    raise ValueError(f"OCR response ended with {finish_reason}")
                parts_text = candidate["content"]["parts"]
                result = json.loads("".join(
                    part["text"] for part in parts_text if isinstance(part.get("text"), str)
                ))
                page_text = result["text"]
                page_uncertain = result["uncertain_sections"]
                if not isinstance(page_text, str) or not isinstance(page_uncertain, list) or not all(
                    isinstance(item, str) for item in page_uncertain
                ):
                    raise ValueError("Unexpected OCR response shape")
                if not page_text.strip():
                    raise ValueError("No readable text found")
            except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
                raise HTTPException(
                    422,
                    f"Text extraction could not reliably read image {page_number}. "
                    "Try a clearer image or enter/correct the rules manually.",
                )
            extracted_pages.append(page_text)
            uncertain_sections.extend(
                [f"Image {page_number}: {section}" for section in page_uncertain]
            )

    return {
        "text": "\n\n".join(extracted_pages),
        "uncertain_sections": uncertain_sections[:100],
    }


@api.post("/owner/rules/ocr")
async def extract_rules_text(body: RulesOcrBody, user: dict = Depends(require_roles("owner"))):
    hostel = await get_owner_hostel(user, body.hostel_id)
    if not hostel:
        raise HTTPException(404, "Hostel not found")
    uploads = await _owned_rules_uploads(body.upload_ids, hostel["id"], user["id"])
    total_size = sum(image["size"] for image in uploads)
    if total_size > RULE_IMAGES_MAX_TOTAL_SIZE:
        raise HTTPException(413, "The combined rules images must be 20 MB or smaller")
    cipher = _rules_image_cipher()
    extracted_pages = []
    uncertain_sections = []
    for image in uploads:
        try:
            encrypted = await asyncio.to_thread(_rules_image_path(image).read_bytes)
            raw = await asyncio.to_thread(cipher.decrypt, encrypted)
        except (OSError, InvalidToken):
            raise HTTPException(500, "A stored rules image could not be read. Upload it again.")
        result = await _request_rules_ocr([(image["content_type"], raw)])
        extracted_pages.append(result["text"])
        uncertain_sections.extend(result["uncertain_sections"])
    result = {
        "text": "\n\n".join(extracted_pages),
        "uncertain_sections": uncertain_sections[:100],
    }
    if result["text"].strip():
        await _save_rules_draft(hostel["id"], user["id"], result["text"], body.upload_ids)
    return {**result, "source_image_ids": body.upload_ids}


@api.get("/owner/rules")
async def owner_get_rules(hostel_id: str, user: dict = Depends(require_roles("owner"))):
    hostel = await get_owner_hostel(user, hostel_id)
    if not hostel:
        raise HTTPException(404, "Hostel not found")
    draft = await db.rule_drafts.find_one({"hostel_id": hostel["id"], "owner_id": user["id"]}, {"_id": 0})
    latest = await _latest_rules_policy(hostel["id"])
    policies = await db.rules_policies.find(
        {"hostel_id": hostel["id"], "status": "published"},
        {"_id": 0},
    ).sort("version", -1).to_list(200)
    return {
        "hostel_id": hostel["id"],
        "draft": draft,
        "latest": latest,
        "history": policies,
    }


@api.put("/owner/rules/draft")
async def owner_save_rules_draft(body: RulesDraftBody, user: dict = Depends(require_roles("owner"))):
    hostel = await get_owner_hostel(user, body.hostel_id)
    if not hostel:
        raise HTTPException(404, "Hostel not found")
    await _owned_rules_uploads(body.source_image_ids, hostel["id"], user["id"])
    saved = await _save_rules_draft(hostel["id"], user["id"], body.text, body.source_image_ids)
    return {"draft": saved}


@api.post("/owner/rules/publish")
async def owner_publish_rules(body: RulesDraftBody, user: dict = Depends(require_roles("owner"))):
    hostel = await get_owner_hostel(user, body.hostel_id)
    if not hostel:
        raise HTTPException(404, "Hostel not found")
    await _owned_rules_uploads(body.source_image_ids, hostel["id"], user["id"])
    await _save_rules_draft(hostel["id"], user["id"], body.text, body.source_image_ids)
    content_hash = hashlib.sha256(body.text.encode("utf-8")).hexdigest()
    query = {"hostel_id": hostel["id"], "content_hash": content_hash, "status": "published"}
    existing = await db.rules_policies.find_one(query, {"_id": 0})
    if existing:
        return {"policy": existing, "already_published": True}

    for _ in range(5):
        version = await db.rules_policies.count_documents({
            "hostel_id": hostel["id"],
            "status": "published",
        }) + 1
        timestamp = now_utc().isoformat()
        policy = {
            "id": new_id(),
            "hostel_id": hostel["id"],
            "owner_id": user["id"],
            "version": version,
            "status": "published",
            "text": body.text,
            "content_hash": content_hash,
            "source_image_ids": body.source_image_ids,
            "created_at": timestamp,
            "published_at": timestamp,
        }
        try:
            await db.rules_policies.insert_one(policy)
            return {"policy": clean(policy), "already_published": False}
        except DuplicateKeyError:
            existing = await db.rules_policies.find_one(query, {"_id": 0})
            if existing:
                return {"policy": existing, "already_published": True}
    raise HTTPException(409, "Another policy version is being published. Refresh and try again.")


@api.get("/owner/rules/acknowledgements")
async def owner_rules_acknowledgements(hostel_id: str, user: dict = Depends(require_roles("owner"))):
    hostel = await get_owner_hostel(user, hostel_id)
    if not hostel:
        raise HTTPException(404, "Hostel not found")
    latest = await _latest_rules_policy(hostel["id"])
    tenants = await db.tenants.find(
        {"hostel_id": hostel["id"], "active": True},
        {"_id": 0},
    ).to_list(5000)
    acknowledgements = await db.rule_acknowledgements.find(
        {"hostel_id": hostel["id"]},
        {"_id": 0},
    ).sort("acknowledged_at", -1).to_list(20000)
    tenant_by_id = {tenant["id"]: tenant for tenant in tenants}
    current_acks = {
        record["tenant_id"]: record
        for record in acknowledgements
        if latest and record.get("policy_id") == latest["id"]
    }
    rows = []
    for tenant in tenants:
        record = current_acks.get(tenant["id"])
        rows.append({
            "tenant_id": tenant["id"],
            "tenant_name": tenant.get("name") or "Tenant",
            "room_number": tenant.get("room_number"),
            "bed_number": tenant.get("bed_number"),
            "policy_version": latest.get("version") if latest else None,
            "status": "Acknowledged" if record else ("Pending" if latest else "No policy published"),
            "acknowledged_at": record.get("acknowledged_at") if record else None,
        })
    history = []
    for record in acknowledgements:
        tenant = tenant_by_id.get(record.get("tenant_id")) or await db.tenants.find_one(
            {"id": record.get("tenant_id"), "hostel_id": hostel["id"]},
            {"_id": 0, "name": 1, "room_number": 1, "bed_number": 1},
        )
        history.append({
            "tenant_id": record.get("tenant_id"),
            "tenant_name": (tenant or {}).get("name") or "Tenant",
            "policy_id": record.get("policy_id"),
            "policy_version": record.get("policy_version"),
            "acknowledged_at": record.get("acknowledged_at"),
        })
    return {
        "hostel_id": hostel["id"],
        "latest_policy_version": latest.get("version") if latest else None,
        "total_active_tenants": len(tenants),
        "acknowledged_count": sum(1 for row in rows if row["status"] == "Acknowledged"),
        "pending_count": sum(1 for row in rows if row["status"] == "Pending"),
        "tenants": rows,
        "history": history,
    }


# ---------------- Tenant routes ----------------
async def _tenant_record(user: dict) -> Optional[dict]:
    t = await db.tenants.find_one({"user_id": user["id"], "active": True}, {"_id": 0})
    if not t:
        t = await db.tenants.find_one({"email": user.get("email"), "active": True}, {"_id": 0})
    return t


async def _rules_tenant_record(user: dict) -> Optional[dict]:
    tenant = await _tenant_record(user)
    if not tenant:
        return None
    if tenant.get("user_id") not in (None, user["id"]):
        return None
    if user.get("hostel_id") and user["hostel_id"] != tenant.get("hostel_id"):
        return None
    return tenant


@api.get("/tenant/rules/pending")
async def tenant_rules_pending(user: dict = Depends(require_roles("tenant"))):
    tenant = await _rules_tenant_record(user)
    if not tenant:
        return {"required": False, "policy": None}
    policy = await _latest_rules_policy(tenant["hostel_id"])
    if not policy:
        return {"required": False, "policy": None}
    acknowledgement = await db.rule_acknowledgements.find_one({
        "tenant_id": tenant["id"],
        "hostel_id": tenant["hostel_id"],
        "policy_id": policy["id"],
    })
    return {
        "required": acknowledgement is None,
        "policy": {
            "id": policy["id"],
            "version": policy["version"],
            "text": policy["text"],
            "published_at": policy["published_at"],
        } if acknowledgement is None else None,
    }


@api.post("/tenant/rules/acknowledge")
async def tenant_acknowledge_rules(
    body: RulesAcknowledgeBody,
    user: dict = Depends(require_roles("tenant")),
):
    tenant = await _rules_tenant_record(user)
    if not tenant:
        raise HTTPException(403, "No active hostel membership was found for this account")
    policy = await _latest_rules_policy(tenant["hostel_id"])
    if not policy or policy["id"] != body.policy_id:
        raise HTTPException(409, "The rules have changed. Reload the latest policy before acknowledging.")
    key = {
        "tenant_id": tenant["id"],
        "hostel_id": tenant["hostel_id"],
        "policy_id": policy["id"],
    }
    existing = await db.rule_acknowledgements.find_one(key, {"_id": 0})
    if existing:
        return {"ok": True, "acknowledgement": existing, "already_acknowledged": True}
    acknowledgement = {
        "id": new_id(),
        **key,
        "policy_version": policy["version"],
        "status": "acknowledged",
        "acknowledged_at": now_utc().isoformat(),
    }
    try:
        await db.rule_acknowledgements.insert_one(acknowledgement)
    except DuplicateKeyError:
        existing = await db.rule_acknowledgements.find_one(key, {"_id": 0})
        if not existing:
            raise
        return {"ok": True, "acknowledgement": existing, "already_acknowledged": True}
    return {"ok": True, "acknowledgement": acknowledgement, "already_acknowledged": False}


@api.get("/tenant/home")
async def tenant_home(user: dict = Depends(require_roles("tenant"))):
    t = await _tenant_record(user)
    if not t:
        return {"has_allocation": False}
    hostel = await db.hostels.find_one({"id": t["hostel_id"]}, {"_id": 0})
    pending_payment = await db.payments.find_one(
        {"tenant_id": t["id"], "status": "pending_owner_approval"},
        {"_id": 0, "id": 1, "amount": 1, "date": 1},
    )
    if not pending_payment:
        pending_payment = await db.payments.find_one(
            {"tenant_id": t["id"], "status": "approval_processing"},
            {"_id": 0, "id": 1, "amount": 1, "date": 1},
        )
    return {"has_allocation": True, "tenant": t, "hostel": hostel, "pending_rent_payment": pending_payment}


@api.get("/tenant/payments")
async def tenant_payments(user: dict = Depends(require_roles("tenant"))):
    t = await _tenant_record(user)
    if not t:
        return {"payments": [], "hostel": None, "tenant": None}
    payments = await db.payments.find({"tenant_id": t["id"]}, {"_id": 0}).sort("date", -1).to_list(1000)
    hostel = await db.hostels.find_one({"id": t["hostel_id"]}, {"_id": 0})
    return {"payments": payments, "hostel": hostel, "tenant": t}


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
        dt = s if isinstance(s, datetime) else datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


async def bed_count_for_hostel(hostel_id: str) -> int:
    rooms = await db.rooms.find({"hostel_id": hostel_id}, {"_id": 0, "beds": 1}).to_list(None)
    return _room_bed_counts(rooms)["total"]


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
    plans = [
        _plan_price_breakdown(plan)
        for plan in await db.plans.find({"active": True}, {"_id": 0}).sort("duration_months", 1).to_list(100)
    ]
    return {
        "hostel_id": h["id"],
        "hostel_name": h["name"],
        "bed_count": beds,
        "slab_label": slab["label"],
        "prices": slab["prices"],
        "plans": plans,
        "payments_enabled": _rzp_ready(),
        "subscription": compute_sub_status(h),
        "history": await db.subscriptions.find({"hostel_id": h["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50),
    }


async def _activate_subscription(
    hostel: dict,
    months: int,
    amount: float,
    method: str,
    owner_id: str,
    plan_name: Optional[str] = None,
    plan_id: Optional[str] = None,
    payment_link_id: Optional[str] = None,
    base_price: Optional[float] = None,
    base_price_paise: Optional[int] = None,
    gst_rate: Optional[int] = None,
    gst_rates: Optional[List[int]] = None,
    charge_type: Optional[str] = None,
    gst_amount: Optional[float] = None,
    gst_amount_paise: Optional[int] = None,
    amount_paise: Optional[int] = None,
):
    now = now_utc()
    current_expiry = _parse_dt(hostel.get("plan_expiry"))
    base = current_expiry if (current_expiry and current_expiry > now) else now
    end = add_months(base, months)
    plan_name = plan_name or ({1: "Monthly", 3: "3-Month", 6: "6-Month", 12: "12-Month"}.get(months, f"{months}-Month") + " Plan")
    invoice_no = "INV-" + now.strftime("%y%m") + "-" + new_id()[:6].upper()
    subscription = {
        "id": new_id(), "owner_id": owner_id, "hostel_id": hostel["id"],
        "plan_name": plan_name, "months": months, "amount": amount, "method": method,
        "currency": "INR",
        "invoice_no": invoice_no, "hostel_name": hostel.get("name"),
        "status": "active", "start": now.isoformat(), "end": end.isoformat(),
        "created_at": now.isoformat(),
    }
    if plan_id:
        subscription["plan_id"] = plan_id
    if base_price is not None:
        subscription["base_price"] = base_price
    if base_price_paise is not None:
        subscription["base_price_paise"] = base_price_paise
    if gst_rate is not None:
        subscription["gst_rate"] = gst_rate
    if gst_rates is not None:
        subscription["gst_rates"] = gst_rates
    if charge_type is not None:
        subscription["charge_type"] = charge_type
    if gst_amount is not None:
        subscription["gst_amount"] = gst_amount
    if gst_amount_paise is not None:
        subscription["gst_amount_paise"] = gst_amount_paise
    if amount_paise is not None:
        subscription["total_amount"] = amount
        subscription["amount_paise"] = amount_paise
    if payment_link_id:
        subscription["payment_link_id"] = payment_link_id
    await db.subscriptions.insert_one(subscription)
    await db.hostels.update_one({"id": hostel["id"]}, {"$set": {
        "premium_plan": plan_name, "plan_expiry": end.isoformat()}})
    return end.isoformat()


class SubLinkBody(BaseModel):
    hostel_id: str
    plan_id: str
    expected_base_price_paise: Optional[int] = Field(default=None, gt=0)
    expected_gst_rate: Optional[int] = None
    expected_gst_rates: Optional[List[Literal[2, 18]]] = None
    expected_gst_amount_paise: Optional[int] = Field(default=None, ge=0)
    expected_total_amount_paise: Optional[int] = Field(default=None, gt=0)


def _plan_price_breakdown(plan: dict) -> dict:
    result = dict(plan)
    result["base_price"] = plan.get("price")
    rates = plan.get("gst_rates")
    if rates is None:
        legacy_rate = plan.get("gst_rate")
        rates = [legacy_rate] if legacy_rate in (2, 18) else None
    if (
        not isinstance(rates, list)
        or not rates
        or any(rate not in (2, 18) for rate in rates)
        or len(set(rates)) != len(rates)
    ):
        result.update({
            "gst_rates": [], "gst_rate": None, "gst_amount": None, "total_amount": None,
            "base_price_paise": None, "gst_amount_paise": None, "total_amount_paise": None,
        })
        return result
    rates = sorted(rates)
    total_rate = sum(rates)
    try:
        base = Decimal(str(plan["price"]))
    except (InvalidOperation, KeyError, TypeError, ValueError):
        result.update({
            "gst_rates": rates, "gst_rate": total_rate, "gst_amount": None, "total_amount": None,
            "base_price_paise": None, "gst_amount_paise": None, "total_amount_paise": None,
        })
        return result
    if not base.is_finite() or base <= 0 or base.as_tuple().exponent < -2:
        result.update({
            "gst_rates": rates, "gst_rate": total_rate, "gst_amount": None, "total_amount": None,
            "base_price_paise": None, "gst_amount_paise": None, "total_amount_paise": None,
        })
        return result
    gst = (base * Decimal(total_rate) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    total = base + gst
    result.update({
        "gst_rates": rates,
        "gst_rate": total_rate,
        "charge_type": "gst",
        "gst_amount": float(gst),
        "total_amount": float(total),
        "base_price_paise": int(base * 100),
        "gst_amount_paise": int(gst * 100),
        "total_amount_paise": int(total * 100),
    })
    return result


@api.post("/payments/subscription/link")
async def create_sub_link(body: SubLinkBody, user: dict = Depends(require_roles("owner"))):
    h = await hostel_owned(user, body.hostel_id)
    if not h:
        raise HTTPException(404, "Hostel not found")
    plan = await db.plans.find_one({"id": body.plan_id, "active": True}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plan not available")
    breakdown = _plan_price_breakdown(plan)
    if breakdown.get("gst_rate") is None:
        raise HTTPException(409, "This plan needs a GST rate configured by an administrator before checkout")
    gst_rates = breakdown["gst_rates"]
    gst_rate = breakdown["gst_rate"]
    charge_type = "gst"
    if not _rzp_ready():
        raise HTTPException(400, "Online payments are not configured yet. Please add Razorpay API credentials.")
    try:
        amount_rupees = Decimal(str(plan["price"]))
    except (InvalidOperation, KeyError, TypeError, ValueError):
        raise HTTPException(422, "The selected plan has an invalid price")
    if not amount_rupees.is_finite() or amount_rupees <= 0 or amount_rupees.as_tuple().exponent < -2:
        raise HTTPException(422, "The selected plan price must be greater than zero and have at most two decimal places")
    gst_rupees = (amount_rupees * Decimal(gst_rate) / Decimal(100)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    total_rupees = amount_rupees + gst_rupees
    base_price_paise = int(amount_rupees * 100)
    gst_amount_paise = int(gst_rupees * 100)
    amount_paise = int(total_rupees * 100)
    if (
        (body.expected_base_price_paise is not None and body.expected_base_price_paise != base_price_paise)
        or (body.expected_gst_rate is not None and body.expected_gst_rate != gst_rate)
        or (body.expected_gst_rates is not None and sorted(body.expected_gst_rates) != gst_rates)
        or (body.expected_gst_amount_paise is not None and body.expected_gst_amount_paise != gst_amount_paise)
        or (body.expected_total_amount_paise is not None and body.expected_total_amount_paise != amount_paise)
    ):
        raise HTTPException(409, "Plan pricing changed. Refresh the plans and confirm the updated total before paying.")
    reference = f"sub_{uuid.uuid4().hex[:24]}"
    import razorpay as _rzp
    rpc = _rzp.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    try:
        link = rpc.payment_link.create({
            "amount": amount_paise, "currency": "INR", "accept_partial": False,
            "reference_id": reference,
            "description": f"Hostel 360 - {plan['name']} - {plan['duration_months']} month(s)",
            "customer": {"name": user.get("name") or "Owner", "contact": user.get("mobile") or "", "email": user.get("email") or ""},
            "notify": {"sms": False, "email": False}, "reminder_enable": False,
            "callback_url": f"{BACKEND_URL}/api/razorpay/callback", "callback_method": "get",
        })
    except Exception as exc:
        logger.exception("Razorpay payment link creation failed for plan %s", body.plan_id)
        raise HTTPException(502, "Razorpay could not create a payment link. Please try again.") from exc
    await db.rp_payments.insert_one({
        "id": new_id(), "payment_link_id": link["id"], "reference_id": reference,
        "hostel_id": h["id"], "owner_id": user["id"], "plan_id": plan["id"],
        "plan_name": plan["name"], "months": plan["duration_months"],
        "base_price": float(amount_rupees), "gst_rates": gst_rates, "gst_rate": gst_rate, "charge_type": charge_type,
        "base_price_paise": base_price_paise, "gst_amount": float(gst_rupees),
        "gst_amount_paise": gst_amount_paise, "total_amount": float(total_rupees),
        "amount": float(total_rupees), "amount_paise": amount_paise, "currency": "INR", "status": "created",
        "activated": False, "created_at": now_utc().isoformat(),
    })
    return {
        "payment_link_id": link["id"],
        "checkout_url": link["short_url"],
        "plan_id": plan["id"],
        "base_price": float(amount_rupees),
        "base_price_paise": base_price_paise,
        "gst_rates": gst_rates,
        "gst_rate": gst_rate,
        "charge_type": charge_type,
        "gst_amount": float(gst_rupees),
        "gst_amount_paise": gst_amount_paise,
        "total_amount": float(total_rupees),
        "total_amount_paise": amount_paise,
        "amount": float(total_rupees),
        "currency": "INR",
    }


def _verify_razorpay_payment_link(rec: dict, remote: dict):
    if remote.get("status") != "paid":
        return False
    if (
        remote.get("id") != rec.get("payment_link_id")
        or remote.get("reference_id") != rec.get("reference_id")
        or remote.get("currency") != rec.get("currency", "INR")
        or remote.get("amount") != rec.get("amount_paise")
        or remote.get("amount_paid") != rec.get("amount_paise")
    ):
        logger.error("Razorpay payment link verification mismatch for %s", rec.get("payment_link_id"))
        raise HTTPException(409, "Payment could not be verified against the selected plan")
    return True


async def _activate_verified_razorpay_payment(rec: dict):
    claimed_at = now_utc().isoformat()
    reclaim_before = (now_utc() - timedelta(minutes=2)).isoformat()
    claim = await db.rp_payments.update_one(
        {
            "payment_link_id": rec["payment_link_id"],
            "activated": {"$ne": True},
            "$or": [
                {"activation_claimed_at": {"$exists": False}},
                {"activation_claimed_at": {"$lt": reclaim_before}},
            ],
        },
        {"$set": {"activation_claimed_at": claimed_at}},
    )
    if not claim.modified_count:
        current = await db.rp_payments.find_one({"payment_link_id": rec["payment_link_id"]}, {"_id": 0})
        return bool(current and current.get("activated"))

    try:
        h = await db.hostels.find_one({"id": rec["hostel_id"], "owner_id": rec["owner_id"]}, {"_id": 0})
        if not h:
            raise HTTPException(404, "Hostel for this payment was not found")
        existing_subscription = await db.subscriptions.find_one(
            {"payment_link_id": rec["payment_link_id"]}, {"_id": 0}
        )
        if existing_subscription:
            await db.hostels.update_one(
                {"id": h["id"], "owner_id": rec["owner_id"]},
                {"$set": {
                    "premium_plan": existing_subscription["plan_name"],
                    "plan_expiry": existing_subscription["end"],
                }},
            )
        else:
            await _activate_subscription(
                h,
                rec["months"],
                rec["amount"],
                "razorpay",
                rec["owner_id"],
                plan_name=rec.get("plan_name"),
                plan_id=rec.get("plan_id"),
                payment_link_id=rec["payment_link_id"],
                base_price=rec.get("base_price"),
                base_price_paise=rec.get("base_price_paise"),
                gst_rate=rec.get("gst_rate"),
                gst_rates=rec.get("gst_rates"),
                charge_type=rec.get("charge_type"),
                gst_amount=rec.get("gst_amount"),
                gst_amount_paise=rec.get("gst_amount_paise"),
                amount_paise=rec.get("amount_paise"),
            )
        await db.rp_payments.update_one(
            {"payment_link_id": rec["payment_link_id"], "activation_claimed_at": claimed_at},
            {"$set": {"status": "paid", "activated": True, "paid_at": now_utc().isoformat()},
             "$unset": {"activation_claimed_at": ""}},
        )
        return True
    except Exception:
        await db.rp_payments.update_one(
            {"payment_link_id": rec["payment_link_id"], "activation_claimed_at": claimed_at},
            {"$unset": {"activation_claimed_at": ""}},
        )
        raise


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
        try:
            remote = rpc.payment_link.fetch(payment_link_id)
        except Exception as exc:
            logger.exception("Razorpay payment status check failed for %s", payment_link_id)
            raise HTTPException(502, "Could not verify the payment with Razorpay. Please try again.") from exc
        if _verify_razorpay_payment_link(rec, remote):
            activated = await _activate_verified_razorpay_payment(rec)
            return {"status": "paid" if activated else "processing", "activated": activated, "months": rec["months"]}
        return {"status": remote.get("status", "pending"), "activated": False}
    return {"status": rec.get("status", "pending"), "activated": False}


@api.get("/razorpay/callback")
async def razorpay_callback(status: str = "paid"):
    from fastapi.responses import HTMLResponse
    return HTMLResponse("<html><body style='font-family:sans-serif;text-align:center;padding-top:80px'>"
                        "<h2>Payment update received</h2><p>Return to the Hostel 360 app while we verify the payment.</p></body></html>")


@api.post("/razorpay/webhook")
async def razorpay_webhook(request: Request):
    import hmac, hashlib, json as _json
    if not RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(503, "Razorpay webhook verification is not configured")
    if not _rzp_ready():
        raise HTTPException(503, "Razorpay API credentials are not configured")
    raw = await request.body()
    sig = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(400, "Invalid webhook signature")
    try:
        event = _json.loads(raw)
    except _json.JSONDecodeError:
        raise HTTPException(400, "Bad payload")
    if event.get("event") in ("payment_link.paid",):
        entity = event.get("payload", {}).get("payment_link", {}).get("entity", {})
        link_id = entity.get("id")
        rec = await db.rp_payments.find_one({"payment_link_id": link_id})
        if rec and not rec.get("activated"):
            import razorpay as _rzp
            rpc = _rzp.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
            try:
                remote = rpc.payment_link.fetch(link_id)
            except Exception as exc:
                logger.exception("Razorpay webhook payment verification failed for %s", link_id)
                raise HTTPException(502, "Could not verify the payment with Razorpay") from exc
            if _verify_razorpay_payment_link(rec, remote):
                await _activate_verified_razorpay_payment(rec)
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
    raise HTTPException(
        status.HTTP_410_GONE,
        "Rent now uses manual UPI payment with owner approval from the tenant Payments screen.",
    )


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


# ---------------- Advertisement routes ----------------
class AdvertisementBody(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    media_type: Literal["image", "video", "link"] = "link"
    media_id: Optional[str] = None
    alt_text: str = Field(default="", max_length=300)
    destination_url: Optional[str] = Field(default=None, max_length=2048)
    target_audience: Literal["users_tenants", "owners", "both"]
    schedule_type: Literal["daily", "monthly"]
    start_at: datetime
    end_at: datetime
    timezone: str = Field(min_length=1, max_length=64)
    daily_start_time: Optional[str] = None
    daily_end_time: Optional[str] = None
    days_of_week: List[int] = Field(default_factory=list, max_length=7)
    days_of_month: List[int] = Field(default_factory=list, max_length=31)
    display_duration_seconds: Literal[5, 10, 15, 30] = 15
    frequency_limit: Optional[int] = Field(default=None, ge=1, le=100)

    @field_validator("title", "description", "alt_text")
    @classmethod
    def trim_ad_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("timezone")
    @classmethod
    def validate_ad_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Choose a valid IANA time zone")
        return value

    @field_validator("start_at", "end_at")
    @classmethod
    def require_ad_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Campaign start and end must include a time-zone offset")
        return value

    @field_validator("daily_start_time", "daily_end_time")
    @classmethod
    def validate_ad_time(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            try:
                time.fromisoformat(value)
            except ValueError:
                raise ValueError("Use a valid local time such as 09:00")
        return value

    @field_validator("days_of_week")
    @classmethod
    def validate_ad_weekdays(cls, value: List[int]) -> List[int]:
        if any(type(day) is not int or day < 0 or day > 6 for day in value):
            raise ValueError("Selected weekdays must be between 0 (Monday) and 6 (Sunday)")
        if len(value) != len(set(value)):
            raise ValueError("Selected weekdays cannot contain duplicates")
        return value

    @field_validator("days_of_month")
    @classmethod
    def validate_ad_monthdays(cls, value: List[int]) -> List[int]:
        if any(type(day) is not int or day < 1 or day > 31 for day in value):
            raise ValueError("Selected monthly dates must be between 1 and 31")
        if len(value) != len(set(value)):
            raise ValueError("Selected monthly dates cannot contain duplicates")
        return value

    @field_validator("destination_url")
    @classmethod
    def validate_ad_destination(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Promotional links must be valid http or https URLs")
        try:
            parsed.port
        except ValueError as exc:
            raise ValueError("Promotional link contains an invalid port") from exc
        return value

    @model_validator(mode="after")
    def validate_ad_campaign(self):
        if not self.title:
            raise ValueError("Advertisement title is required")
        if self.start_at >= self.end_at:
            raise ValueError("Campaign end must be after campaign start")
        if self.media_type in ("image", "video") and not self.media_id:
            raise ValueError("Upload an image or video for this advertisement")
        if self.media_type == "link" and self.media_id:
            raise ValueError("Link-only advertisements cannot include a media upload")
        if self.media_type == "link" and not self.destination_url:
            raise ValueError("Provide a promotional link or upload an image or video")
        if bool(self.daily_start_time) != bool(self.daily_end_time):
            raise ValueError("Provide both daily display-window times")
        if self.daily_start_time and self.daily_end_time and self.daily_start_time == self.daily_end_time:
            raise ValueError("Daily display start and end times must be different")
        return self


class AdvertisementActionBody(BaseModel):
    action: Literal["publish", "pause"]


class AdvertisementEventBody(BaseModel):
    event: Literal["click"]


class AdvertisementImpressionBody(BaseModel):
    reservation_token: str = Field(min_length=20, max_length=100)


class AdvertisementSettingsBody(BaseModel):
    ads_enabled: bool
    free_cooldown_minutes: int = Field(ge=30, le=10080)
    premium_cooldown_minutes: int = Field(ge=30, le=10080)


def _ad_datetime(value) -> datetime:
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _ad_audience_allows(ad: dict, role: str) -> bool:
    return ad.get("target_audience") == "both" or (
        role == "tenant" and ad.get("target_audience") == "users_tenants"
    ) or (role == "owner" and ad.get("target_audience") == "owners")


def _ad_current_status(ad: dict, at: Optional[datetime] = None) -> str:
    saved_status = ad.get("status", "draft")
    if saved_status in ("draft", "deleted"):
        return saved_status
    current = at or now_utc()
    if current >= _ad_datetime(ad["end_at"]):
        return "expired"
    if saved_status == "paused":
        return "paused"
    if current < _ad_datetime(ad["start_at"]):
        return "scheduled"
    return "active"


def _ad_is_scheduled_now(ad: dict, at: Optional[datetime] = None) -> bool:
    current = at or now_utc()
    if _ad_current_status(ad, current) != "active":
        return False
    zone = ZoneInfo(ad.get("timezone") or "UTC")
    local_now = current.astimezone(zone)
    start_text = ad.get("daily_start_time")
    end_text = ad.get("daily_end_time")
    local_time = local_now.timetz().replace(tzinfo=None)
    start_time = time.fromisoformat(start_text) if start_text else None
    end_time = time.fromisoformat(end_text) if end_text else None
    schedule_date = local_now.date()
    if start_time and end_time and end_time < start_time and local_time < end_time:
        schedule_date -= timedelta(days=1)

    if ad.get("schedule_type") == "daily":
        weekdays = ad.get("days_of_week") or []
        if weekdays and schedule_date.weekday() not in weekdays:
            return False
    elif ad.get("schedule_type") == "monthly":
        monthdays = ad.get("days_of_month") or []
        if monthdays and schedule_date.day not in monthdays:
            return False

    if start_time and end_time:
        if start_time < end_time:
            return start_time <= local_time < end_time
        return local_time >= start_time or local_time < end_time
    return True


def _ad_viewer_hash(user_id: str, local_date: str) -> str:
    return hmac.new(
        JWT_SECRET.encode(),
        f"{local_date}:{user_id}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _ad_media_url(media_id: Optional[str], ad_id: Optional[str], user: dict) -> Optional[str]:
    if not media_id:
        return None
    claims = {
        "sub": user["id"],
        "role": user["role"],
        "media_id": media_id,
        "ad_id": ad_id,
        "purpose": "advertisement_media",
        "exp": now_utc() + timedelta(minutes=10),
    }
    token = jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGO)
    return f"/api/advertisements/media/{media_id}?token={token}"


async def _ad_public_document(
    ad: dict,
    user: dict,
    admin: bool = False,
    impression_token: Optional[str] = None,
) -> dict:
    result = {key: value for key, value in ad.items() if key not in ("_id", "media_id")}
    if not admin:
        result.pop("created_by", None)
        result.pop("updated_at", None)
        result.pop("created_at", None)
    result["media_url"] = _ad_media_url(ad.get("media_id"), ad.get("id"), user)
    result["status"] = _ad_current_status(ad)
    if impression_token:
        result["impression_token"] = impression_token
    if admin:
        result["media_id"] = ad.get("media_id")
        impressions = await db.advertisement_events.count_documents(
            {"ad_id": ad["id"], "event": "impression"}
        )
        clicks = await db.advertisement_events.count_documents(
            {"ad_id": ad["id"], "event": "click"}
        )
        result["impressions"] = impressions
        result["clicks"] = clicks
        result["click_through_rate"] = round(clicks * 100 / impressions, 2) if impressions else 0
    return result


async def _refresh_advertisement_statuses():
    ads = await db.advertisements.find(
        {"status": {"$in": ["active", "scheduled", "paused"]}},
        {"_id": 0},
    ).to_list(1000)
    for ad in ads:
        current_status = _ad_current_status(ad)
        if current_status != ad.get("status"):
            await db.advertisements.update_one(
                {"id": ad["id"]},
                {"$set": {"status": current_status, "updated_at": now_utc().isoformat()}},
            )


async def _refresh_advertisement_statuses_periodically():
    while True:
        try:
            await _refresh_advertisement_statuses()
        except Exception:
            logger.exception("Could not refresh advertisement campaign statuses")
        await asyncio.sleep(60)


async def _ad_is_eligible(ad: dict, user: dict, at: Optional[datetime] = None) -> bool:
    return (
        _ad_audience_allows(ad, user.get("role", ""))
        and ad.get("status") in ("active", "scheduled")
        and _ad_is_scheduled_now(ad, at)
    )


async def _cleanup_ad_media(media_id: Optional[str]):
    if not media_id:
        return
    reference = await db.advertisements.find_one({"media_id": media_id}, {"_id": 0})
    if reference:
        return
    media = await db.ad_media.find_one({"id": media_id}, {"_id": 0})
    if media:
        media_path = AD_MEDIA_DIR / f"{media_id}.{media['extension']}"
        if media_path.is_file():
            media_path.unlink()
        await db.ad_media.delete_one({"id": media_id})


@api.post("/admin/advertisements/media")
async def upload_advertisement_media(
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("admin")),
):
    logger.info(
        "Advertisement media upload received: filename=%s content_type=%s",
        Path(file.filename or "").name,
        file.content_type,
    )
    original_name = (file.filename or "").lower()
    extension = original_name.rsplit(".", 1)[-1] if "." in original_name else ""
    formats = {
        "jpg": ("image", "image/jpeg"),
        "jpeg": ("image", "image/jpeg"),
        "png": ("image", "image/png"),
        "webp": ("image", "image/webp"),
        "mp4": ("video", "video/mp4"),
        "webm": ("video", "video/webm"),
    }
    if extension not in formats or file.content_type != formats[extension][1]:
        raise HTTPException(400, "Upload a JPG, PNG, WebP, MP4, or WebM file with a matching file type")
    media_type, content_type = formats[extension]
    byte_limit = AD_IMAGE_LIMIT if media_type == "image" else AD_VIDEO_LIMIT
    AD_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    media_id = new_id()
    media_path = AD_MEDIA_DIR / f"{media_id}.{extension}"
    size = 0
    try:
        with media_path.open("wb") as output:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > byte_limit:
                    raise HTTPException(
                        413,
                        f"{'Image' if media_type == 'image' else 'Video'} exceeds the {byte_limit // (1024 * 1024)} MB size limit",
                    )
                output.write(chunk)
        if size == 0:
            raise HTTPException(400, "The uploaded file is empty")
        if media_type == "image":
            from PIL import Image
            try:
                with Image.open(media_path) as image:
                    image.verify()
                    actual_format = image.format
            except (OSError, ValueError, Image.DecompressionBombError) as exc:
                raise HTTPException(400, "The uploaded file is not a valid supported image") from exc
            expected_formats = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}
            if actual_format != expected_formats[extension]:
                raise HTTPException(400, "The uploaded image content does not match its file type")
        else:
            with media_path.open("rb") as uploaded:
                signature = uploaded.read(12)
            valid_video = (
                extension == "mp4" and len(signature) >= 12 and signature[4:8] == b"ftyp"
            ) or (extension == "webm" and signature.startswith(b"\x1a\x45\xdf\xa3"))
            if not valid_video:
                raise HTTPException(400, "The uploaded video content does not match its file type")
        media = {
            "id": media_id,
            "media_type": media_type,
            "content_type": content_type,
            "extension": extension,
            "size": size,
            "created_by": user["id"],
            "created_at": now_utc().isoformat(),
        }
        await db.ad_media.insert_one(media)
    except Exception:
        logger.exception(
            "Advertisement media upload failed: filename=%s content_type=%s bytes_written=%d",
            Path(file.filename or "").name,
            file.content_type,
            size,
        )
        if media_path.exists():
            media_path.unlink()
        raise
    return {
        "media_id": media_id,
        "media_type": media_type,
        "size": size,
        "media_url": _ad_media_url(media_id, None, user),
    }


@api.delete("/admin/advertisements/media/{media_id}")
async def discard_advertisement_media(media_id: str, user: dict = Depends(require_roles("admin"))):
    media = await db.ad_media.find_one({"id": media_id}, {"_id": 0})
    if not media:
        return {"ok": True}
    if media.get("created_by") != user["id"]:
        raise HTTPException(403, "You can only discard media that you uploaded")
    if await db.advertisements.find_one({"media_id": media_id}, {"_id": 0}):
        raise HTTPException(409, "This media is still used by an advertisement")
    await _cleanup_ad_media(media_id)
    return {"ok": True}


@api.get("/admin/advertisements")
async def list_advertisements(user: dict = Depends(require_roles("admin"))):
    advertisements = await db.advertisements.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    results = []
    for ad in advertisements:
        current_status = _ad_current_status(ad)
        if ad.get("status") in ("active", "scheduled", "paused") and current_status == "expired":
            await db.advertisements.update_one({"id": ad["id"]}, {"$set": {"status": "expired"}})
            ad["status"] = "expired"
        results.append(await _ad_public_document(ad, user, admin=True))
    return {"advertisements": results}


@api.post("/admin/advertisements")
async def create_advertisement(body: AdvertisementBody, user: dict = Depends(require_roles("admin"))):
    if body.media_id:
        media = await db.ad_media.find_one({"id": body.media_id}, {"_id": 0})
        if not media or media.get("media_type") != body.media_type:
            raise HTTPException(400, "Uploaded media is missing or does not match the selected media type")
    stamp = now_utc().isoformat()
    ad = {
        "id": new_id(),
        **body.model_dump(),
        "start_at": body.start_at.isoformat(),
        "end_at": body.end_at.isoformat(),
        "status": "draft",
        "created_by": user["id"],
        "created_at": stamp,
        "updated_at": stamp,
    }
    await db.advertisements.insert_one(ad)
    return {"advertisement": await _ad_public_document(ad, user, admin=True)}


@api.get("/admin/advertisements/settings")
async def admin_advertisement_settings(user: dict = Depends(require_roles("admin"))):
    return await _advertisement_settings()


@api.put("/admin/advertisements/settings")
async def update_admin_advertisement_settings(
    body: AdvertisementSettingsBody,
    user: dict = Depends(require_roles("admin")),
):
    settings = body.model_dump()
    await db.advertisement_settings.update_one(
        {"id": "global"},
        {"$set": {"id": "global", **settings, "updated_at": now_utc().isoformat(), "updated_by": user["id"]}},
        upsert=True,
    )
    return settings


@api.put("/admin/advertisements/{advertisement_id}")
async def update_advertisement(
    advertisement_id: str,
    body: AdvertisementBody,
    user: dict = Depends(require_roles("admin")),
):
    current = await db.advertisements.find_one({"id": advertisement_id}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Advertisement not found")
    if body.media_id:
        media = await db.ad_media.find_one({"id": body.media_id}, {"_id": 0})
        if not media or media.get("media_type") != body.media_type:
            raise HTTPException(400, "Uploaded media is missing or does not match the selected media type")
    updates = body.model_dump()
    updates["start_at"] = body.start_at.isoformat()
    updates["end_at"] = body.end_at.isoformat()
    updates["updated_at"] = now_utc().isoformat()
    if _ad_current_status(current) == "expired":
        updates["status"] = "draft"
    await db.advertisements.update_one({"id": advertisement_id}, {"$set": updates})
    if current.get("media_id") != body.media_id:
        await _cleanup_ad_media(current.get("media_id"))
    updated = await db.advertisements.find_one({"id": advertisement_id}, {"_id": 0})
    return {"advertisement": await _ad_public_document(updated, user, admin=True)}


@api.post("/admin/advertisements/{advertisement_id}/status")
async def update_advertisement_status(
    advertisement_id: str,
    body: AdvertisementActionBody,
    user: dict = Depends(require_roles("admin")),
):
    ad = await db.advertisements.find_one({"id": advertisement_id}, {"_id": 0})
    if not ad:
        raise HTTPException(404, "Advertisement not found")
    if body.action == "pause":
        if _ad_current_status(ad) not in ("active", "scheduled"):
            raise HTTPException(400, "Only a published advertisement can be paused")
        next_status = "paused"
    else:
        if ad.get("status") not in ("draft", "paused", "scheduled", "active"):
            raise HTTPException(400, "An expired advertisement cannot be published again; edit it with a new campaign window first")
        next_status = _ad_current_status({**ad, "status": "active"})
        if next_status == "expired":
            raise HTTPException(400, "Campaign end must be in the future before publishing")
    await db.advertisements.update_one(
        {"id": advertisement_id},
        {"$set": {"status": next_status, "updated_at": now_utc().isoformat()}},
    )
    ad["status"] = next_status
    return {"advertisement": await _ad_public_document(ad, user, admin=True)}


@api.delete("/admin/advertisements/{advertisement_id}")
async def delete_advertisement(advertisement_id: str, user: dict = Depends(require_roles("admin"))):
    ad = await db.advertisements.find_one({"id": advertisement_id}, {"_id": 0})
    if not ad:
        raise HTTPException(404, "Advertisement not found")
    await db.advertisements.delete_one({"id": advertisement_id})
    await _cleanup_ad_media(ad.get("media_id"))
    return {"ok": True}


async def _advertisement_settings() -> dict:
    settings = await db.advertisement_settings.find_one({"id": "global"}, {"_id": 0})
    resolved = {
        key: settings.get(key, default) if settings else default
        for key, default in AD_DEFAULT_SETTINGS.items()
    }
    for key in ("free_cooldown_minutes", "premium_cooldown_minutes"):
        resolved[key] = max(30, resolved[key])
    return resolved


async def _migrate_advertisement_cooldown_defaults():
    for previous_defaults in (AD_PREVIOUS_DEFAULT_SETTINGS, AD_LEGACY_DEFAULT_SETTINGS):
        await db.advertisement_settings.update_one(
            {"id": "global", **previous_defaults},
            {"$set": {
                "free_cooldown_minutes": AD_DEFAULT_SETTINGS["free_cooldown_minutes"],
                "premium_cooldown_minutes": AD_DEFAULT_SETTINGS["premium_cooldown_minutes"],
            }},
        )


def _ad_frequency_viewer_hash(user_id: str) -> str:
    return hmac.new(
        JWT_SECRET.encode(),
        f"ad-frequency:{user_id}".encode(),
        hashlib.sha256,
    ).hexdigest()


async def _ad_user_is_paid_premium(user: dict) -> bool:
    now = now_utc()
    if user.get("role") == "owner":
        hostels = await db.hostels.find({"owner_id": user["id"]}, {"_id": 0}).to_list(200)
    else:
        tenant = await _tenant_record(user)
        if not tenant:
            return False
        hostel = await db.hostels.find_one({"id": tenant.get("hostel_id")}, {"_id": 0})
        hostels = [hostel] if hostel else []
    return any(
        (expiry := _parse_dt(hostel.get("plan_expiry"))) is not None and expiry > now
        for hostel in hostels
    )


async def _ad_daily_cap_available(ad: dict, user: dict, now: datetime) -> bool:
    frequency_limit = ad.get("frequency_limit")
    if frequency_limit is None:
        return True
    local_date = now.astimezone(ZoneInfo(ad.get("timezone") or "UTC")).date().isoformat()
    daily_viewer_hash = _ad_viewer_hash(user["id"], local_date)
    impressions = await db.advertisement_events.count_documents({
        "ad_id": ad["id"],
        "event": "impression",
        "viewer_hash": daily_viewer_hash,
    })
    return impressions < frequency_limit


async def _clear_ad_reservation(viewer_hash: str, token: Optional[str] = None):
    query = {"viewer_hash": viewer_hash}
    if token:
        query["reservation.token"] = token
    await db.advertisement_frequency.update_one(query, {"$set": {"reservation": None}})


async def _reserve_advertisement(viewer_hash: str, ad: dict, now: datetime) -> Optional[dict]:
    current = await db.advertisement_frequency.find_one({"viewer_hash": viewer_hash}, {"_id": 0})
    reservation = {
        "token": secrets.token_urlsafe(32),
        "ad_id": ad["id"],
        "expires_at": now + timedelta(seconds=AD_RESERVATION_SECONDS),
    }
    if current is None:
        try:
            await db.advertisement_frequency.insert_one({
                "viewer_hash": viewer_hash,
                "reservation": reservation,
                "updated_at": now,
            })
            return reservation
        except DuplicateKeyError:
            return None

    query = {"viewer_hash": viewer_hash}
    last_display_at = current.get("last_display_at")
    query["last_display_at"] = last_display_at if last_display_at is not None else {"$exists": False}
    old_reservation = current.get("reservation")
    old_token = old_reservation.get("token") if isinstance(old_reservation, dict) else None
    query["reservation.token"] = old_token if old_token else {"$exists": False}
    result = await db.advertisement_frequency.update_one(query, {"$set": {
        "reservation": reservation,
        "updated_at": now,
    }})
    return reservation if result.matched_count == 1 else None


async def _existing_advertisement_reservation(viewer_hash: str, user: dict, now: datetime) -> Optional[dict]:
    state = await db.advertisement_frequency.find_one({"viewer_hash": viewer_hash}, {"_id": 0})
    reservation = state.get("reservation") if state else None
    if not isinstance(reservation, dict):
        return None
    expires_at = _parse_dt(reservation.get("expires_at"))
    if expires_at is None or expires_at <= now:
        await _clear_ad_reservation(viewer_hash, reservation.get("token"))
        return None
    ad = await db.advertisements.find_one({"id": reservation.get("ad_id")}, {"_id": 0})
    if (
        not ad
        or not await _ad_is_eligible(ad, user, now)
        or not await _ad_daily_cap_available(ad, user, now)
    ):
        await _clear_ad_reservation(viewer_hash, reservation.get("token"))
        return None
    return {"advertisement": ad, "reservation": reservation}


async def _deliver_reserved_advertisement(ad: dict, user: dict, reservation: dict) -> dict:
    return {
        "advertisement": await _ad_public_document(ad, user, impression_token=reservation["token"]),
    }


@api.get("/advertisements/current")
async def current_advertisement(user: dict = Depends(require_roles("owner", "tenant"))):
    now = now_utc()
    settings = await _advertisement_settings()
    viewer_hash = _ad_frequency_viewer_hash(user["id"])
    if not settings.get("ads_enabled", True):
        await _clear_ad_reservation(viewer_hash)
        return {"advertisement": None}

    state = await db.advertisement_frequency.find_one({"viewer_hash": viewer_hash}, {"_id": 0})
    premium = await _ad_user_is_paid_premium(user)
    cooldown_minutes = settings[
        "premium_cooldown_minutes" if premium else "free_cooldown_minutes"
    ]
    last_display_at = _parse_dt(state.get("last_display_at")) if state else None
    if last_display_at and now < last_display_at + timedelta(minutes=cooldown_minutes):
        return {"advertisement": None}

    existing = await _existing_advertisement_reservation(viewer_hash, user, now)
    if existing:
        return await _deliver_reserved_advertisement(existing["advertisement"], user, existing["reservation"])

    ads = await db.advertisements.find(
        {"status": {"$in": ["active", "scheduled"]}},
        {"_id": 0},
    ).to_list(500)
    eligible = [
        ad for ad in ads
        if await _ad_is_eligible(ad, user, now)
        and await _ad_daily_cap_available(ad, user, now)
    ]
    random.shuffle(eligible)
    for ad in eligible:
        reservation = await _reserve_advertisement(viewer_hash, ad, now)
        if reservation:
            return await _deliver_reserved_advertisement(ad, user, reservation)
        existing = await _existing_advertisement_reservation(viewer_hash, user, now)
        if existing:
            return await _deliver_reserved_advertisement(existing["advertisement"], user, existing["reservation"])
        return {"advertisement": None}
    return {"advertisement": None}


@api.post("/advertisements/{advertisement_id}/impression")
async def record_advertisement_impression(
    advertisement_id: str,
    body: AdvertisementImpressionBody,
    user: dict = Depends(require_roles("owner", "tenant")),
):
    now = now_utc()
    viewer_hash = _ad_frequency_viewer_hash(user["id"])
    state = await db.advertisement_frequency.find_one({"viewer_hash": viewer_hash}, {"_id": 0})
    settings = await _advertisement_settings()
    if not settings.get("ads_enabled", True):
        await _clear_ad_reservation(viewer_hash, body.reservation_token)
        return {"displayed": False}
    if state and state.get("last_impression_token") == body.reservation_token:
        ad = await db.advertisements.find_one({"id": advertisement_id}, {"_id": 0})
        return {"displayed": bool(ad and await _ad_is_eligible(ad, user, now))}
    reservation = state.get("reservation") if state else None
    reservation_expires_at = _parse_dt(reservation.get("expires_at")) if isinstance(reservation, dict) else None
    if (
        not isinstance(reservation, dict)
        or reservation.get("token") != body.reservation_token
        or reservation.get("ad_id") != advertisement_id
        or reservation_expires_at is None
        or reservation_expires_at <= now
    ):
        raise HTTPException(409, "Advertisement reservation expired or was already used")
    ad = await db.advertisements.find_one({"id": advertisement_id}, {"_id": 0})
    if not ad or not await _ad_is_eligible(ad, user, now):
        await _clear_ad_reservation(viewer_hash, body.reservation_token)
        return {"displayed": False}

    frequency_limit = ad.get("frequency_limit")
    local_date = now.astimezone(ZoneInfo(ad.get("timezone") or "UTC")).date().isoformat()
    daily_viewer_hash = _ad_viewer_hash(user["id"], local_date)
    frequency_slot = None
    if frequency_limit is not None:
        frequency_slot = await db.advertisement_events.count_documents({
            "ad_id": ad["id"],
            "event": "impression",
            "viewer_hash": daily_viewer_hash,
        })
        if frequency_slot >= frequency_limit:
            await _clear_ad_reservation(viewer_hash, body.reservation_token)
            return {"displayed": False}

    claimed = await db.advertisement_frequency.update_one(
        {
            "viewer_hash": viewer_hash,
            "reservation.token": body.reservation_token,
        },
        {"$set": {
            "last_display_at": now,
            "last_impression_token": body.reservation_token,
            "reservation": None,
            "updated_at": now,
        }},
    )
    if claimed.matched_count != 1:
        raise HTTPException(409, "Advertisement reservation expired or was already used")

    impression = {
        "id": new_id(),
        "ad_id": ad["id"],
        "event": "impression",
        "viewer_hash": daily_viewer_hash,
        "created_at": now,
    }
    if frequency_slot is not None:
        impression["frequency_slot"] = frequency_slot
    await db.advertisement_events.insert_one(impression)
    return {"displayed": True}


@api.post("/advertisements/{advertisement_id}/click")
async def click_advertisement(
    advertisement_id: str,
    body: AdvertisementEventBody,
    user: dict = Depends(require_roles("owner", "tenant")),
):
    ad = await db.advertisements.find_one({"id": advertisement_id}, {"_id": 0})
    if not ad or not await _ad_is_eligible(ad, user):
        raise HTTPException(404, "Advertisement is not available")
    if not ad.get("destination_url"):
        raise HTTPException(400, "This advertisement has no promotional link")
    now = now_utc()
    local_date = now.astimezone(ZoneInfo(ad.get("timezone") or "UTC")).date().isoformat()
    await db.advertisement_events.insert_one({
        "id": new_id(),
        "ad_id": advertisement_id,
        "event": "click",
        "viewer_hash": _ad_viewer_hash(user["id"], local_date),
        "created_at": now,
    })
    return {"destination_url": ad["destination_url"]}


def _stream_file_range(media_path: Path, start: int, end: int, chunk_size: int = 64 * 1024):
    with media_path.open("rb") as media_file:
        media_file.seek(start)
        remaining = end - start + 1
        while remaining:
            chunk = media_file.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _parse_single_byte_range(range_header: str, file_size: int) -> Optional[tuple[int, int]]:
    if file_size <= 0 or not range_header.startswith("bytes=") or "," in range_header:
        return None
    range_start, separator, range_end = range_header[6:].partition("-")
    if not separator:
        return None
    try:
        if not range_start:
            suffix_length = int(range_end)
            if suffix_length <= 0:
                return None
            return max(file_size - suffix_length, 0), file_size - 1
        start = int(range_start)
        end = int(range_end) if range_end else file_size - 1
    except ValueError:
        return None
    if start < 0 or start >= file_size or end < start:
        return None
    return start, min(end, file_size - 1)


@api.get("/advertisements/media/{media_id}")
async def get_advertisement_media(media_id: str, token: str, range_header: Optional[str] = Header(None, alias="Range")):
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(401, "Advertisement media link is invalid or expired")
    if claims.get("purpose") != "advertisement_media" or claims.get("media_id") != media_id:
        raise HTTPException(401, "Advertisement media link is invalid")
    media = await db.ad_media.find_one({"id": media_id}, {"_id": 0})
    if not media or len(media_id) != 32 or any(char not in "0123456789abcdef" for char in media_id):
        raise HTTPException(404, "Advertisement media not found")
    advertisement_id = claims.get("ad_id")
    if advertisement_id:
        ad = await db.advertisements.find_one({"id": advertisement_id, "media_id": media_id}, {"_id": 0})
        if not ad:
            raise HTTPException(404, "Advertisement media not found")
        if claims.get("role") == "admin":
            if ad.get("status") not in ("active", "scheduled", "paused", "draft", "expired"):
                raise HTTPException(404, "Advertisement media not found")
        elif (
            not _ad_audience_allows(ad, claims.get("role", ""))
            or not await _ad_is_eligible(ad, {"role": claims.get("role", "")})
        ):
            raise HTTPException(404, "Advertisement media not available")
    elif claims.get("role") != "admin":
        raise HTTPException(403, "Only admins may preview unassigned advertisement media")
    media_path = AD_MEDIA_DIR / f"{media_id}.{media['extension']}"
    if not media_path.is_file():
        raise HTTPException(404, "Advertisement media file not found")
    response_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
    }
    if range_header is not None:
        file_size = media_path.stat().st_size
        byte_range = _parse_single_byte_range(range_header, file_size)
        if byte_range is None:
            return Response(
                status_code=416,
                headers={
                    **response_headers,
                    "Content-Range": f"bytes */{file_size}",
                },
            )
        start, end = byte_range
        response_headers.update({
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(end - start + 1),
        })
        return StreamingResponse(
            _stream_file_range(media_path, start, end),
            status_code=206,
            media_type=media["content_type"],
            headers=response_headers,
        )
    return FileResponse(
        media_path,
        media_type=media["content_type"],
        headers=response_headers,
    )


# ---------------- Startup ----------------
async def _ensure_google_subject_index():
    await db.users.create_index(
        "google_sub",
        unique=True,
        sparse=True,
        name="user_google_sub",
    )


async def _ensure_rules_indexes():
    await db.rules_image_uploads.create_index("id", unique=True, name="rules_image_id")
    await db.rule_drafts.create_index("hostel_id", unique=True, name="rules_draft_hostel")
    await db.rules_policies.create_index("id", unique=True, name="rules_policy_id")
    await db.rules_policies.create_index(
        [("hostel_id", 1), ("version", 1)],
        unique=True,
        name="rules_policy_hostel_version",
    )
    await db.rules_policies.create_index(
        [("hostel_id", 1), ("content_hash", 1)],
        unique=True,
        name="rules_policy_content_idempotency",
    )
    await db.rule_acknowledgements.create_index("id", unique=True, name="rules_acknowledgement_id")
    await db.rule_acknowledgements.create_index(
        [("tenant_id", 1), ("hostel_id", 1), ("policy_version", 1)],
        unique=True,
        name="rules_acknowledgement_tenant_version",
    )
    await db.rule_acknowledgements.create_index(
        [("hostel_id", 1), ("policy_id", 1)],
        name="rules_acknowledgement_policy",
    )


async def _ensure_tenant_report_duplicate_index():
    indexes = await db.tenant_reports.index_information()
    for index in indexes.values():
        if index.get("key") == [("duplicate_key", 1)] and index.get("unique") is True:
            return

    index_name = "tenant_report_duplicate"
    if index_name in indexes:
        index_name = "tenant_report_duplicate_scoped"

    duplicates = await db.tenant_reports.aggregate([
        {"$match": {"duplicate_key": {"$type": "string"}}},
        {"$group": {"_id": "$duplicate_key", "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
        {"$limit": 1},
    ]).to_list(1)
    if duplicates:
        raise RuntimeError(
            "Duplicate tenant report keys exist; resolve those specific records before creating the unique index"
        )
    await db.tenant_reports.create_index(
        "duplicate_key",
        unique=True,
        partialFilterExpression={"duplicate_key": {"$type": "string"}},
        name=index_name,
    )


async def _ensure_tenant_active_identity_index():
    indexes = await db.tenants.index_information()
    expected_keys = [("hostel_id", 1), ("user_id", 1)]
    for index in indexes.values():
        if (
            index.get("key") == expected_keys
            and index.get("unique") is True
            and index.get("partialFilterExpression") == {
                "active": True,
                "identity_guarded": True,
                "user_id": {"$type": "string"},
            }
        ):
            return

    duplicates = await db.tenants.aggregate([
        {"$match": {
            "active": True,
            "identity_guarded": True,
            "user_id": {"$type": "string"},
        }},
        {"$group": {
            "_id": {"hostel_id": "$hostel_id", "user_id": "$user_id"},
            "count": {"$sum": 1},
        }},
        {"$match": {"count": {"$gt": 1}}},
        {"$limit": 1},
    ]).to_list(1)
    if duplicates:
        raise RuntimeError(
            "Duplicate guarded active tenant memberships exist; reconcile those records before creating the unique index"
        )
    index_name = "tenant_active_global_membership"
    if index_name in indexes:
        index_name = "tenant_active_global_membership_scoped"
    await db.tenants.create_index(
        expected_keys,
        unique=True,
        partialFilterExpression={
            "active": True,
            "identity_guarded": True,
            "user_id": {"$type": "string"},
        },
        name=index_name,
    )


async def _ensure_tenant_query_indexes():
    indexes = await db.tenants.index_information()
    expected = [
        ([("id", 1)], "tenant_id_lookup"),
        ([("hostel_id", 1), ("created_at", -1)], "tenant_hostel_created"),
    ]
    for keys, requested_name in expected:
        if any(details.get("key") == keys for details in indexes.values()):
            continue
        name = requested_name
        if name in indexes:
            name = f"{requested_name}_scoped"
        await db.tenants.create_index(keys, name=name)


async def _ensure_tenant_upi_reference_index():
    index_name = "tenant_upi_reference"
    expected_key = [("tenant_id", 1), ("upi_reference", 1)]
    expected_filter = {"upi_reference": {"$type": "string"}}
    indexes = await db.payments.index_information()
    for details in indexes.values():
        if (
            details.get("key") == expected_key
            and details.get("unique") is True
            and details.get("partialFilterExpression") == expected_filter
        ):
            return
    if index_name in indexes:
        raise RuntimeError(
            f"MongoDB index {index_name} exists with an incompatible definition; inspect it before changing payment data."
        )
    duplicates = await db.payments.aggregate([
        {"$match": {"upi_reference": {"$type": "string"}}},
        {"$group": {
            "_id": {"tenant_id": "$tenant_id", "upi_reference": "$upi_reference"},
            "count": {"$sum": 1},
        }},
        {"$match": {"count": {"$gt": 1}}},
        {"$limit": 5},
    ]).to_list(5)
    if duplicates:
        raise RuntimeError(
            "Cannot create the tenant UPI reference index because existing duplicate payment references require review."
        )
    await db.payments.create_index(
        expected_key,
        unique=True,
        partialFilterExpression=expected_filter,
        name=index_name,
    )


@app.on_event("startup")
async def startup():
    _validate_production_config()
    existing_admin = await db.users.find_one(
        {"email": ADMIN_EMAIL.lower()},
        {"_id": 0, "password_hash": 1},
    )
    _validate_existing_admin(existing_admin)
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await _ensure_tenant_aadhaar_claim_index()
    await db.tenant_history_share_codes.create_index("id", unique=True, name="tenant_history_share_code_id")
    await db.tenant_history_share_codes.create_index("code_hash", unique=True, name="tenant_history_share_code_hash")
    await db.tenant_history_share_codes.create_index(
        [("tenant_user_id", 1), ("expires_at", 1)],
        name="tenant_history_share_code_expiry",
    )
    await db.tenant_history_share_codes.create_index(
        "expires_at", expireAfterSeconds=0, name="tenant_history_share_code_ttl"
    )
    await db.tenant_history_grants.create_index("id", unique=True, name="tenant_history_grant_id")
    await db.tenant_history_grants.create_index(
        [("owner_id", 1), ("hostel_id", 1), ("expires_at", 1)],
        name="tenant_history_grant_owner_hostel_expiry",
    )
    await db.tenant_history_grants.create_index(
        "expires_at", expireAfterSeconds=0, name="tenant_history_grant_ttl"
    )
    await db.tenant_reports.create_index("id", unique=True, name="tenant_report_id")
    await _ensure_tenant_report_duplicate_index()
    await db.tenant_reports.create_index(
        [("tenant_user_id", 1), ("created_at", -1)],
        name="tenant_report_global_history",
    )
    await db.tenant_reports.create_index(
        [("hostel_id", 1), ("tenant_id", 1), ("created_at", -1)],
        name="tenant_report_membership_history",
    )
    await db.tenant_report_settlements.create_index("id", unique=True, name="tenant_report_settlement_id")
    await db.tenant_report_settlements.create_index(
        [("report_id", 1), ("created_at", 1)],
        name="tenant_report_settlement_ledger",
    )
    await db.tenant_history_audit.create_index("id", unique=True, name="tenant_history_audit_id")
    await db.tenant_history_audit.create_index(
        [("report_id", 1), ("created_at", 1)],
        name="tenant_history_audit_report",
    )
    await db.tenant_report_evidence.create_index("id", unique=True, name="tenant_report_evidence_id")
    await db.tenant_report_evidence.create_index(
        [("report_id", 1), ("created_at", 1)],
        name="tenant_report_evidence_report",
    )
    await db.tenant_history_notifications.create_index(
        "id", unique=True, name="tenant_history_notification_id"
    )
    await db.tenant_history_notifications.create_index(
        [("recipient_user_id", 1), ("recipient_role", 1), ("created_at", -1)],
        name="tenant_history_notification_recipient",
    )
    await _ensure_tenant_upi_reference_index()
    await db.rent_payment_evidence.create_index("id", unique=True, name="rent_payment_evidence_id")
    await db.rent_payment_evidence.create_index(
        [("hostel_id", 1), ("created_at", -1)],
        name="rent_payment_evidence_hostel",
    )
    await _ensure_tenant_active_identity_index()
    await _ensure_tenant_query_indexes()
    await _ensure_google_subject_index()
    await db.user_sessions.create_index("session_token", unique=True)
    await db.advertisements.create_index("id", unique=True)
    await db.advertisements.create_index("status")
    await db.advertisement_settings.create_index("id", unique=True)
    await db.expense_categories.create_index(
        [("owner_id", 1), ("hostel_id", 1), ("normalized_name", 1)],
        unique=True,
        partialFilterExpression={"normalized_name": {"$type": "string"}},
        name="expense_category_owner_property_name",
    )
    await db.advertisement_frequency.create_index("viewer_hash", unique=True, name="ad_frequency_viewer")
    await _migrate_advertisement_cooldown_defaults()
    await db.advertisement_events.create_index([("ad_id", 1), ("event", 1), ("viewer_hash", 1)])
    await db.advertisement_events.create_index(
        [("ad_id", 1), ("viewer_hash", 1), ("frequency_slot", 1)],
        unique=True,
        partialFilterExpression={"event": "impression", "frequency_slot": {"$exists": True}},
        name="ad_impression_frequency_slots",
    )
    await db.ad_media.create_index("id", unique=True)
    await _ensure_rules_indexes()
    # seed admin
    if not existing_admin:
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
    await _ensure_room_key_index()
    global AD_STATUS_REFRESH_TASK
    AD_STATUS_REFRESH_TASK = asyncio.create_task(_refresh_advertisement_statuses_periodically())


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
        ("1", "101", 1, 9500), ("1", "102", 2, 7000),
        ("2", "201", 2, 6500), ("2", "202", 3, 5500),
    ]
    for floor, rno, bed_count, rent in room_specs:
        beds = [{"bed_number": f"{rno}-{i+1}", "status": "available", "tenant_id": None} for i in range(bed_count)]
        room = {"id": new_id(), "hostel_id": main_hostel["id"], "floor": floor, "room_number": rno,
                "bed_count": bed_count, "rent": rent, "beds": beds, "created_at": now_utc().isoformat()}
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
    if AD_STATUS_REFRESH_TASK:
        AD_STATUS_REFRESH_TASK.cancel()
        try:
            await AD_STATUS_REFRESH_TASK
        except asyncio.CancelledError:
            pass
    client.close()


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
