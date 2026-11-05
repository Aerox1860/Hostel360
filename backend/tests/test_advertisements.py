import asyncio
import os
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError
from starlette.datastructures import Headers
from starlette.datastructures import UploadFile

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_advertisement_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


ADMIN = {"id": "admin-1", "role": "admin"}
OWNER = {"id": "owner-1", "role": "owner"}
TENANT = {"id": "tenant-1", "role": "tenant"}


class Cursor:
    def __init__(self, documents):
        self.documents = documents

    def sort(self, key, direction=1):
        if isinstance(key, list):
            key, direction = key[0]
        self.documents.sort(key=lambda item: item.get(key, ""), reverse=direction < 0)
        return self

    async def to_list(self, length):
        return deepcopy(self.documents if length is None else self.documents[:length])


def matches(document, query):
    for key, expected in query.items():
        actual = document
        for part in key.split("."):
            actual = actual.get(part) if isinstance(actual, dict) else None
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$exists" in expected and (actual is not None) != expected["$exists"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$gte" in expected and (actual is None or actual < expected["$gte"]):
                return False
            if "$lt" in expected and (actual is None or actual >= expected["$lt"]):
                return False
            if "$lte" in expected and (actual is None or actual > expected["$lte"]):
                return False
            if "$gt" in expected and (actual is None or actual <= expected["$gt"]):
                return False
        elif actual != expected:
            return False
    return True


class FakeCollection:
    def __init__(self, documents=None, frequency_slots=False, unique_keys=()):
        self.documents = deepcopy(documents or [])
        self.frequency_slots = frequency_slots
        self.unique_keys = unique_keys

    def find(self, query=None, projection=None):
        query = query or {}
        return Cursor([doc for doc in self.documents if matches(doc, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        return deepcopy(next((doc for doc in self.documents if matches(doc, query)), None))

    async def insert_one(self, document):
        await asyncio.sleep(0)
        for key in self.unique_keys:
            if key in document and any(old.get(key) == document[key] for old in self.documents):
                raise DuplicateKeyError(f"Duplicate value for {key}")
        if self.frequency_slots and "frequency_slot" in document and any(
            all(old.get(key) == document.get(key) for key in ("ad_id", "viewer_hash", "frequency_slot"))
            for old in self.documents
        ):
            raise DuplicateKeyError("Duplicate ad impression frequency slot")
        self.documents.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update, upsert=False):
        document = next((doc for doc in self.documents if matches(doc, query)), None)
        if not document:
            if upsert:
                document = deepcopy(query)
                document.pop("id", None)
                document.update(deepcopy(update.get("$set", {})))
                self.documents.append(document)
                return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=document.get("id"))
            return SimpleNamespace(matched_count=0, modified_count=0)
        document.update(deepcopy(update.get("$set", {})))
        return SimpleNamespace(matched_count=1, modified_count=1)

    async def delete_one(self, query):
        for index, document in enumerate(self.documents):
            if matches(document, query):
                del self.documents[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def count_documents(self, query):
        return sum(matches(document, query) for document in self.documents)

    async def create_index(self, *args, **kwargs):
        return "test_index"


def active_ad(ad_id="ad-1", target="both", **overrides):
    now = datetime.now(timezone.utc)
    ad = {
        "id": ad_id,
        "title": ad_id,
        "description": "A promotion",
        "media_type": "link",
        "media_id": None,
        "alt_text": "",
        "destination_url": "https://example.com/promo",
        "target_audience": target,
        "schedule_type": "daily",
        "start_at": (now - timedelta(hours=1)).isoformat(),
        "end_at": (now + timedelta(hours=1)).isoformat(),
        "timezone": "UTC",
        "daily_start_time": None,
        "daily_end_time": None,
        "days_of_week": [],
        "days_of_month": [],
        "display_duration_seconds": 15,
        "frequency_limit": None,
        "status": "active",
        "created_at": now.isoformat(),
    }
    ad.update(overrides)
    return ad


@pytest.fixture
def fake_db(monkeypatch):
    db = SimpleNamespace(
        users=FakeCollection(),
        advertisements=FakeCollection(),
        advertisement_events=FakeCollection(frequency_slots=True),
        ad_media=FakeCollection(),
        advertisement_settings=FakeCollection(),
        advertisement_frequency=FakeCollection(unique_keys=("viewer_hash",)),
        hostels=FakeCollection(),
        tenants=FakeCollection(),
    )
    monkeypatch.setattr(server, "db", db)
    yield db
    server.app.dependency_overrides.clear()


def campaign_body(**overrides):
    now = datetime.now(timezone.utc)
    body = {
        "title": "Summer deal",
        "description": "A short promotion",
        "media_type": "link",
        "destination_url": "https://example.com/promo",
        "target_audience": "both",
        "schedule_type": "daily",
        "start_at": (now - timedelta(minutes=1)).isoformat(),
        "end_at": (now + timedelta(days=30)).isoformat(),
        "timezone": "Asia/Kolkata",
        "display_duration_seconds": 15,
    }
    body.update(overrides)
    return server.AdvertisementBody(**body)


def test_campaign_validation_rejects_naive_dates_bad_timezone_and_unsafe_urls():
    with pytest.raises(ValidationError):
        campaign_body(start_at="2026-10-01T09:00:00")
    with pytest.raises(ValidationError):
        campaign_body(timezone="not/a-timezone")
    with pytest.raises(ValidationError):
        campaign_body(destination_url="javascript:alert(1)")
    with pytest.raises(ValidationError):
        campaign_body(destination_url="https://example.com:bad/path")
    with pytest.raises(ValidationError):
        campaign_body(media_type="image")
    with pytest.raises(ValidationError):
        campaign_body(daily_start_time="09:00")


def test_campaign_validation_accepts_safe_link_and_recurring_schedule():
    body = campaign_body(
        destination_url="https://example.com/promo",
        schedule_type="monthly",
        days_of_month=[1, 15, 31],
        display_duration_seconds=30,
        frequency_limit=3,
    )
    assert body.days_of_month == [1, 15, 31]
    assert body.frequency_limit == 3


def test_audience_filter_isolated_for_tenants_owners_and_both(fake_db):
    fake_db.advertisements.documents = [
        active_ad("tenant-ad", "users_tenants"),
        active_ad("owner-ad", "owners"),
        active_ad("both-ad", "both"),
    ]

    assert [ad["id"] for ad in fake_db.advertisements.documents if server._ad_audience_allows(ad, "tenant")] == [
        "tenant-ad",
        "both-ad",
    ]
    assert [ad["id"] for ad in fake_db.advertisements.documents if server._ad_audience_allows(ad, "owner")] == [
        "owner-ad",
        "both-ad",
    ]
    assert not server._ad_audience_allows(active_ad(target="owners"), "tenant")


def test_delivery_api_enforces_role_and_returns_only_matching_audience(fake_db):
    current_user = [TENANT]

    async def override_user():
        return current_user[0]

    server.app.dependency_overrides[server.get_current_user] = override_user
    client = TestClient(server.app)

    assert client.get("/api/admin/advertisements").status_code == 403
    cases = [
        ("users_tenants", TENANT, OWNER),
        ("owners", OWNER, TENANT),
    ]
    for index, (audience, matching_role, excluded_role) in enumerate(cases):
        fake_db.advertisements.documents = [active_ad(f"audience-{index}", audience)]
        current_user[0] = matching_role
        assert client.get("/api/advertisements/current").json()["advertisement"]["id"] == f"audience-{index}"
        current_user[0] = excluded_role
        assert client.get("/api/advertisements/current").json()["advertisement"] is None
        fake_db.advertisement_frequency.documents.clear()
    fake_db.advertisements.documents = [active_ad("both-owner", "both")]
    current_user[0] = OWNER
    assert client.get("/api/advertisements/current").json()["advertisement"]["id"] == "both-owner"
    current_user[0] = TENANT
    assert client.get("/api/advertisements/current").json()["advertisement"]["id"] == "both-owner"


def test_authenticated_unallocated_tenant_receives_first_targeted_ad(fake_db):
    tenant_user = {
        "id": "unallocated-tenant",
        "role": "tenant",
        "email": "tenant@example.com",
        "active": True,
    }
    owner_user = {
        "id": "owner-without-hostel",
        "role": "owner",
        "email": "owner@example.com",
        "active": True,
    }
    fake_db.users.documents = [tenant_user, owner_user]
    fake_db.advertisements.documents = [active_ad("tenant-first-ad", "users_tenants")]
    client = TestClient(server.app)

    unauthenticated = client.get("/api/advertisements/current")
    assert unauthenticated.status_code == 401

    tenant_response = client.get(
        "/api/advertisements/current",
        headers={"Authorization": f"Bearer {server.make_token(tenant_user)}"},
    )
    assert tenant_response.status_code == 200
    assert tenant_response.json()["advertisement"]["id"] == "tenant-first-ad"

    owner_response = client.get(
        "/api/advertisements/current",
        headers={"Authorization": f"Bearer {server.make_token(owner_user)}"},
    )
    assert owner_response.status_code == 200
    assert owner_response.json()["advertisement"] is None


def test_authenticated_tenant_impression_persists_cooldown_and_ack_is_idempotent(fake_db):
    tenant_user = {
        "id": "cooldown-tenant",
        "role": "tenant",
        "email": "tenant@example.com",
        "active": True,
    }
    fake_db.users.documents = [tenant_user]
    fake_db.advertisements.documents = [active_ad("tenant-cooldown-ad", "users_tenants")]
    client = TestClient(server.app)
    headers = {"Authorization": f"Bearer {server.make_token(tenant_user)}"}

    delivery = client.get("/api/advertisements/current", headers=headers)
    assert delivery.status_code == 200
    advertisement = delivery.json()["advertisement"]
    assert advertisement["id"] == "tenant-cooldown-ad"

    impression_path = f"/api/advertisements/{advertisement['id']}/impression"
    impression_body = {"reservation_token": advertisement["impression_token"]}
    assert client.post(impression_path, json=impression_body, headers=headers).json() == {"displayed": True}
    assert client.post(impression_path, json=impression_body, headers=headers).json() == {"displayed": True}
    assert client.get("/api/advertisements/current", headers=headers).json()["advertisement"] is None
    assert len(fake_db.advertisement_events.documents) == 1


def test_naive_mongo_reservation_expiry_is_accepted_as_utc(fake_db):
    fake_db.advertisements.documents = [active_ad("naive-expiry", "users_tenants")]
    first = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    state = fake_db.advertisement_frequency.documents[0]
    state["reservation"]["expires_at"] = state["reservation"]["expires_at"].replace(tzinfo=None)

    repeated = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    assert repeated["id"] == first["id"]
    assert repeated["impression_token"] == first["impression_token"]
    result = asyncio.run(server.record_advertisement_impression(
        first["id"],
        server.AdvertisementImpressionBody(reservation_token=first["impression_token"]),
        TENANT,
    ))
    assert result == {"displayed": True}
    assert len(fake_db.advertisement_events.documents) == 1


def test_legacy_campaign_without_audience_is_not_delivered_or_retargeted(fake_db):
    legacy = active_ad("legacy-ad")
    legacy.pop("target_audience")
    fake_db.advertisements.documents = [legacy]

    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"] is None
    assert asyncio.run(server.current_advertisement(OWNER))["advertisement"] is None
    assert "target_audience" not in fake_db.advertisements.documents[0]


def test_both_campaign_delivers_to_both_roles(fake_db):
    fake_db.advertisements.documents = [active_ad("both-ad", "both")]
    tenant_result = asyncio.run(server.current_advertisement(TENANT))
    owner_result = asyncio.run(server.current_advertisement(OWNER))
    assert tenant_result["advertisement"]["id"] == "both-ad"
    assert owner_result["advertisement"]["id"] == "both-ad"
    asyncio.run(server.record_advertisement_impression(
        "both-ad",
        server.AdvertisementImpressionBody(
            reservation_token=tenant_result["advertisement"]["impression_token"]
        ),
        TENANT,
    ))
    asyncio.run(server.record_advertisement_impression(
        "both-ad",
        server.AdvertisementImpressionBody(
            reservation_token=owner_result["advertisement"]["impression_token"]
        ),
        OWNER,
    ))
    assert len(fake_db.advertisement_events.documents) == 2


def test_dashboard_media_url_is_relative_even_with_localhost_backend(fake_db, monkeypatch):
    monkeypatch.setattr(server, "BACKEND_URL", "http://localhost:8000")
    public = asyncio.run(server._ad_public_document(
        active_ad("relative-media", "both", media_id="a" * 32, media_type="image"),
        TENANT,
    ))
    parsed = urlsplit(public["media_url"])
    assert parsed.scheme == ""
    assert parsed.netloc == ""
    assert parsed.path == f"/api/advertisements/media/{'a' * 32}"
    claims = server.jwt.decode(parse_qs(parsed.query)["token"][0], server.JWT_SECRET, algorithms=[server.JWT_ALGO])
    assert claims["sub"] == TENANT["id"]
    assert claims["role"] == TENANT["role"]


def test_video_media_route_supports_byte_ranges_and_rejects_invalid_range(fake_db, monkeypatch, tmp_path):
    media_id = "b" * 32
    media_content = b"video-content"
    fake_db.advertisements.documents = [
        active_ad("range-video", "both", media_id=media_id, media_type="video")
    ]
    fake_db.ad_media.documents = [{
        "id": media_id,
        "media_type": "video",
        "content_type": "video/mp4",
        "extension": "mp4",
    }]
    monkeypatch.setattr(server, "AD_MEDIA_DIR", tmp_path)
    (tmp_path / f"{media_id}.mp4").write_bytes(media_content)
    token = server.jwt.encode({
        "sub": TENANT["id"],
        "role": TENANT["role"],
        "media_id": media_id,
        "ad_id": "range-video",
        "purpose": "advertisement_media",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }, server.JWT_SECRET, algorithm=server.JWT_ALGO)

    client = TestClient(server.app)
    url = f"/api/advertisements/media/{media_id}"
    ranged = client.get(url, params={"token": token}, headers={"Range": "bytes=2-6"})
    assert ranged.status_code == 206
    assert ranged.content == media_content[2:7]
    assert ranged.headers["content-type"] == "video/mp4"
    assert ranged.headers["accept-ranges"] == "bytes"
    assert ranged.headers["content-range"] == f"bytes 2-6/{len(media_content)}"
    assert ranged.headers["content-length"] == "5"

    invalid = client.get(url, params={"token": token}, headers={"Range": "bytes=99-"})
    assert invalid.status_code == 416
    assert invalid.headers["content-range"] == f"bytes */{len(media_content)}"

    full = client.get(url, params={"token": token})
    assert full.status_code == 200
    assert full.content == media_content
    assert full.headers["content-type"] == "video/mp4"


def test_daily_and_monthly_recurrences_and_campaign_expiry(fake_db):
    current = datetime(2026, 10, 15, 9, 30, tzinfo=timezone.utc)
    daily = active_ad(
        start_at=(current - timedelta(days=1)).isoformat(),
        end_at=(current + timedelta(days=1)).isoformat(),
        days_of_week=[current.weekday()],
        daily_start_time="09:00",
        daily_end_time="10:00",
    )
    assert server._ad_is_scheduled_now(daily, current)
    assert not server._ad_is_scheduled_now({**daily, "days_of_week": [(current.weekday() + 1) % 7]}, current)
    assert not server._ad_is_scheduled_now({**daily, "daily_start_time": "10:00", "daily_end_time": "11:00"}, current)
    overnight = active_ad(
        start_at=(current - timedelta(days=1)).isoformat(),
        end_at=(current + timedelta(days=1)).isoformat(),
        days_of_week=[(current.weekday() - 1) % 7],
        daily_start_time="22:00",
        daily_end_time="02:00",
    )
    after_midnight = current.replace(hour=0, minute=30)
    assert server._ad_is_scheduled_now(overnight, after_midnight)

    monthly = active_ad(
        schedule_type="monthly",
        days_of_month=[15],
        start_at="2026-10-01T00:00:00+00:00",
        end_at="2026-11-01T00:00:00+00:00",
    )
    assert server._ad_is_scheduled_now(monthly, current)
    assert not server._ad_is_scheduled_now({**monthly, "days_of_month": [16]}, current)
    assert server._ad_current_status(monthly, datetime(2026, 11, 2, tzinfo=timezone.utc)) == "expired"


def test_campaign_status_refresh_activates_and_expires_campaigns(fake_db):
    now = datetime.now(timezone.utc)
    fake_db.advertisements.documents = [
        active_ad("ready", "both", status="scheduled", start_at=(now - timedelta(minutes=1)).isoformat()),
        active_ad("ended", "both", status="active", end_at=(now - timedelta(minutes=1)).isoformat()),
        active_ad("paused-ended", "both", status="paused", end_at=(now - timedelta(minutes=1)).isoformat()),
    ]
    asyncio.run(server._refresh_advertisement_statuses())
    statuses = {ad["id"]: ad["status"] for ad in fake_db.advertisements.documents}
    assert statuses == {"ready": "active", "ended": "expired", "paused-ended": "expired"}


def test_frequency_limit_is_enforced_under_concurrent_delivery(fake_db):
    ad = active_ad(frequency_limit=1)
    fake_db.advertisements.documents = [ad]

    async def concurrent_requests():
        return await asyncio.gather(
            server.current_advertisement(TENANT),
            server.current_advertisement(TENANT),
        )

    first, second = asyncio.run(concurrent_requests())
    assert first["advertisement"]["id"] == second["advertisement"]["id"]
    assert (
        first["advertisement"]["impression_token"]
        == second["advertisement"]["impression_token"]
    )
    body = server.AdvertisementImpressionBody(
        reservation_token=first["advertisement"]["impression_token"]
    )

    async def concurrent_impressions():
        return await asyncio.gather(
            server.record_advertisement_impression("ad-1", body, TENANT),
            server.record_advertisement_impression("ad-1", body, TENANT),
        )

    displayed = asyncio.run(concurrent_impressions())
    assert all(result["displayed"] for result in displayed)
    assert len(fake_db.advertisement_events.documents) == 1
    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"] is None


def test_free_tenant_cooldown_is_30_minutes_and_does_not_queue_ads(fake_db):
    fake_db.advertisements.documents = [active_ad("hourly-free", "both")]
    first = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    assert first["id"] == "hourly-free"
    assert asyncio.run(server.record_advertisement_impression(
        first["id"],
        server.AdvertisementImpressionBody(reservation_token=first["impression_token"]),
        TENANT,
    ))["displayed"]
    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"] is None

    state = fake_db.advertisement_frequency.documents[0]
    state["last_display_at"] = datetime.now(timezone.utc) - timedelta(minutes=29, seconds=59)
    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"] is None
    state["last_display_at"] = datetime.now(timezone.utc) - timedelta(minutes=31)
    next_ad = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    assert next_ad["id"] == "hourly-free"


def test_tenant_with_only_a_free_trial_uses_free_cooldown(fake_db):
    tenant_user = {**TENANT, "email": "tenant@example.com"}
    fake_db.tenants.documents = [{
        "id": "trial-tenant",
        "user_id": tenant_user["id"],
        "active": True,
        "hostel_id": "trial-hostel",
    }]
    fake_db.hostels.documents = [{
        "id": "trial-hostel",
        "trial_ends_at": (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
        "plan_expiry": None,
    }]
    fake_db.advertisements.documents = [active_ad("trial-ad", "users_tenants")]
    ad = asyncio.run(server.current_advertisement(tenant_user))["advertisement"]
    asyncio.run(server.record_advertisement_impression(
        ad["id"],
        server.AdvertisementImpressionBody(reservation_token=ad["impression_token"]),
        tenant_user,
    ))
    state = fake_db.advertisement_frequency.documents[0]
    state["last_display_at"] = datetime.now(timezone.utc) - timedelta(minutes=61)
    assert asyncio.run(server.current_advertisement(tenant_user))["advertisement"]["id"] == "trial-ad"
    state["last_display_at"] = datetime.now(timezone.utc) - timedelta(minutes=29)
    assert asyncio.run(server.current_advertisement(tenant_user))["advertisement"] is None


def test_paid_premium_user_cooldown_is_30_minutes(fake_db):
    fake_db.advertisements.documents = [active_ad("premium-ad", "both")]
    fake_db.hostels.documents = [{
        "id": "paid-hostel",
        "owner_id": OWNER["id"],
        "plan_expiry": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
    }]
    first = asyncio.run(server.current_advertisement(OWNER))["advertisement"]
    assert first["id"] == "premium-ad"
    asyncio.run(server.record_advertisement_impression(
        first["id"],
        server.AdvertisementImpressionBody(reservation_token=first["impression_token"]),
        OWNER,
    ))
    assert asyncio.run(server.current_advertisement(OWNER))["advertisement"] is None

    state = fake_db.advertisement_frequency.documents[0]
    state["last_display_at"] = datetime.now(timezone.utc) - timedelta(minutes=29)
    assert asyncio.run(server.current_advertisement(OWNER))["advertisement"] is None
    state["last_display_at"] = datetime.now(timezone.utc) - timedelta(minutes=31)
    assert asyncio.run(server.current_advertisement(OWNER))["advertisement"]["id"] == "premium-ad"


def test_paid_tenant_uses_hostel_subscription_for_premium_cooldown(fake_db):
    tenant_user = {**TENANT, "email": "tenant@example.com"}
    fake_db.tenants.documents = [{
        "id": "tenant-record",
        "user_id": tenant_user["id"],
        "active": True,
        "hostel_id": "paid-hostel",
    }]
    fake_db.hostels.documents = [{
        "id": "paid-hostel",
        "plan_expiry": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
    }]
    fake_db.advertisements.documents = [active_ad("paid-tenant-ad", "users_tenants")]
    first = asyncio.run(server.current_advertisement(tenant_user))["advertisement"]
    assert first["id"] == "paid-tenant-ad"
    asyncio.run(server.record_advertisement_impression(
        first["id"],
        server.AdvertisementImpressionBody(reservation_token=first["impression_token"]),
        tenant_user,
    ))
    assert asyncio.run(server.current_advertisement(tenant_user))["advertisement"] is None
    state = fake_db.advertisement_frequency.documents[0]
    state["last_display_at"] = datetime.now(timezone.utc) - timedelta(minutes=31)
    assert asyncio.run(server.current_advertisement(tenant_user))["advertisement"]["id"] == "paid-tenant-ad"


def test_campaign_daily_cap_remains_in_force_after_cooldown(fake_db):
    fake_db.advertisements.documents = [active_ad("daily-cap", "both", frequency_limit=1)]
    first = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    asyncio.run(server.record_advertisement_impression(
        first["id"],
        server.AdvertisementImpressionBody(reservation_token=first["impression_token"]),
        TENANT,
    ))
    fake_db.advertisement_frequency.documents[0]["last_display_at"] = (
        datetime.now(timezone.utc) - timedelta(minutes=31)
    )
    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"] is None
    assert len(fake_db.advertisement_events.documents) == 1


def test_admin_settings_control_global_ads_and_cooldown_values(fake_db):
    async def override_admin():
        return ADMIN

    server.app.dependency_overrides[server.get_current_user] = override_admin
    client = TestClient(server.app)
    initial = client.get("/api/admin/advertisements/settings")
    assert initial.status_code == 200
    assert initial.json() == {
        "ads_enabled": True,
        "free_cooldown_minutes": 30,
        "premium_cooldown_minutes": 30,
    }
    updated = client.put("/api/admin/advertisements/settings", json={
        "ads_enabled": False,
        "free_cooldown_minutes": 45,
        "premium_cooldown_minutes": 180,
    })
    assert updated.status_code == 200
    assert updated.json() == {
        "ads_enabled": False,
        "free_cooldown_minutes": 45,
        "premium_cooldown_minutes": 180,
    }
    fake_db.advertisements.documents = [active_ad("off-ad", "both")]
    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"] is None
    assert fake_db.advertisement_events.documents == []
    rejected = client.put("/api/admin/advertisements/settings", json={
        "ads_enabled": True,
        "free_cooldown_minutes": 29,
        "premium_cooldown_minutes": 30,
    })
    assert rejected.status_code == 422


def test_migration_updates_only_legacy_default_cooldowns(fake_db):
    fake_db.advertisement_settings.documents = [{
        "id": "global",
        "ads_enabled": False,
        "free_cooldown_minutes": 30,
        "premium_cooldown_minutes": 120,
    }]
    asyncio.run(server._migrate_advertisement_cooldown_defaults())
    migrated = fake_db.advertisement_settings.documents[0]
    assert migrated["ads_enabled"] is False
    assert migrated["free_cooldown_minutes"] == 30
    assert migrated["premium_cooldown_minutes"] == 30

    fake_db.advertisement_settings.documents[0]["free_cooldown_minutes"] = 45
    asyncio.run(server._migrate_advertisement_cooldown_defaults())
    assert fake_db.advertisement_settings.documents[0]["free_cooldown_minutes"] == 45


def test_configured_free_cooldown_is_enforced(fake_db):
    fake_db.advertisement_settings.documents = [{
        "id": "global",
        "ads_enabled": True,
        "free_cooldown_minutes": 45,
        "premium_cooldown_minutes": 180,
    }]
    fake_db.advertisements.documents = [active_ad("configured-cooldown", "both")]
    first = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    asyncio.run(server.record_advertisement_impression(
        first["id"],
        server.AdvertisementImpressionBody(reservation_token=first["impression_token"]),
        TENANT,
    ))
    state = fake_db.advertisement_frequency.documents[0]
    state["last_display_at"] = datetime.now(timezone.utc) - timedelta(minutes=44)
    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"] is None
    state["last_display_at"] = datetime.now(timezone.utc) - timedelta(minutes=46)
    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"]["id"] == "configured-cooldown"


def test_global_ads_off_rejects_a_pending_display_ack(fake_db):
    fake_db.advertisements.documents = [active_ad("off-before-display", "both")]
    ad = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    fake_db.advertisement_settings.documents = [{
        "id": "global",
        "ads_enabled": False,
        "free_cooldown_minutes": 30,
        "premium_cooldown_minutes": 120,
    }]
    result = asyncio.run(server.record_advertisement_impression(
        ad["id"],
        server.AdvertisementImpressionBody(reservation_token=ad["impression_token"]),
        TENANT,
    ))
    assert result == {"displayed": False}
    assert fake_db.advertisement_events.documents == []


def test_global_ads_off_rejects_a_repeated_ack(fake_db):
    fake_db.advertisements.documents = [active_ad("turn-off-after-display", "both")]
    ad = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    body = server.AdvertisementImpressionBody(reservation_token=ad["impression_token"])
    assert asyncio.run(server.record_advertisement_impression(ad["id"], body, TENANT)) == {"displayed": True}
    fake_db.advertisement_settings.documents = [{
        "id": "global",
        "ads_enabled": False,
        "free_cooldown_minutes": 30,
        "premium_cooldown_minutes": 30,
    }]
    assert asyncio.run(server.record_advertisement_impression(ad["id"], body, TENANT)) == {"displayed": False}
    assert len(fake_db.advertisement_events.documents) == 1


def test_campaign_pause_and_schedule_gate_reserved_delivery(fake_db):
    fake_db.advertisements.documents = [
        active_ad("paused-campaign", "both", status="paused"),
        active_ad("future-campaign", "both", status="scheduled", start_at=(
            datetime.now(timezone.utc) + timedelta(hours=1)
        ).isoformat()),
    ]
    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"] is None
    assert fake_db.advertisement_frequency.documents == []


def test_no_campaign_does_not_queue_a_later_ad(fake_db):
    assert asyncio.run(server.current_advertisement(TENANT))["advertisement"] is None
    fake_db.advertisements.documents = [active_ad("new-campaign", "both")]
    ad = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    assert ad["id"] == "new-campaign"


def test_display_ack_endpoint_records_one_impression_and_starts_cooldown(fake_db):
    fake_db.advertisements.documents = [active_ad("ack-route", "both")]

    async def override_owner():
        return OWNER

    server.app.dependency_overrides[server.get_current_user] = override_owner
    client = TestClient(server.app)
    response = client.get("/api/advertisements/current")
    assert response.status_code == 200
    advertisement = response.json()["advertisement"]
    ack = client.post(
        f"/api/advertisements/{advertisement['id']}/impression",
        json={"reservation_token": advertisement["impression_token"]},
    )
    assert ack.status_code == 200
    assert ack.json() == {"displayed": True}
    repeat = client.post(
        f"/api/advertisements/{advertisement['id']}/impression",
        json={"reservation_token": advertisement["impression_token"]},
    )
    assert repeat.status_code == 200
    assert repeat.json() == {"displayed": True}
    assert len(fake_db.advertisement_events.documents) == 1
    assert client.get("/api/advertisements/current").json()["advertisement"] is None


def test_non_admin_cannot_change_advertisement_settings(fake_db):
    async def override_tenant():
        return TENANT

    server.app.dependency_overrides[server.get_current_user] = override_tenant
    response = TestClient(server.app).put("/api/admin/advertisements/settings", json={
        "ads_enabled": False,
        "free_cooldown_minutes": 30,
        "premium_cooldown_minutes": 120,
    })
    assert response.status_code == 403
    assert fake_db.advertisement_settings.documents == []


def test_impression_click_and_click_through_reporting(fake_db):
    fake_db.advertisements.documents = [active_ad("metric-ad", "both")]
    ad = fake_db.advertisements.documents[0]
    reserved = asyncio.run(server.current_advertisement(TENANT))["advertisement"]
    asyncio.run(server.record_advertisement_impression(
        "metric-ad",
        server.AdvertisementImpressionBody(reservation_token=reserved["impression_token"]),
        TENANT,
    ))
    result = asyncio.run(server.click_advertisement("metric-ad", server.AdvertisementEventBody(event="click"), TENANT))
    public = asyncio.run(server._ad_public_document(ad, ADMIN, admin=True))
    assert result["destination_url"] == "https://example.com/promo"
    assert public["impressions"] == 1
    assert public["clicks"] == 1
    assert public["click_through_rate"] == 100


def test_click_rejects_an_ad_for_the_other_audience(fake_db):
    fake_db.advertisements.documents = [active_ad("owner-only", "owners")]
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.click_advertisement(
            "owner-only",
            server.AdvertisementEventBody(event="click"),
            TENANT,
        ))
    assert error.value.status_code == 404
    assert fake_db.advertisement_events.documents == []


def test_signed_media_route_rejects_another_audience(fake_db, monkeypatch, tmp_path):
    media_id = "a" * 32
    fake_db.advertisements.documents = [
        active_ad("owner-media", "owners", media_id=media_id, media_type="image")
    ]
    fake_db.ad_media.documents = [{
        "id": media_id,
        "media_type": "image",
        "content_type": "image/png",
        "extension": "png",
    }]
    monkeypatch.setattr(server, "AD_MEDIA_DIR", tmp_path)
    token = server.jwt.encode({
        "sub": TENANT["id"],
        "role": TENANT["role"],
        "media_id": media_id,
        "ad_id": "owner-media",
        "purpose": "advertisement_media",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }, server.JWT_SECRET, algorithm=server.JWT_ALGO)
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.get_advertisement_media(media_id, token))
    assert error.value.status_code == 404


def test_media_upload_validates_image_content_and_safe_discard(fake_db, monkeypatch, tmp_path):
    from PIL import Image

    image_bytes = BytesIO()
    Image.new("RGB", (1, 1), color="red").save(image_bytes, format="PNG")
    monkeypatch.setattr(server, "AD_MEDIA_DIR", tmp_path)
    upload = UploadFile(
        file=BytesIO(image_bytes.getvalue()),
        filename="promotion.png",
        headers=Headers({"content-type": "image/png"}),
    )
    uploaded = asyncio.run(server.upload_advertisement_media(upload, ADMIN))
    assert uploaded["media_type"] == "image"
    assert (tmp_path / f"{uploaded['media_id']}.png").is_file()
    asyncio.run(server.discard_advertisement_media(uploaded["media_id"], ADMIN))
    assert not (tmp_path / f"{uploaded['media_id']}.png").exists()
    assert fake_db.ad_media.documents == []


def test_fastapi_multipart_upload_accepts_requested_formats(fake_db, monkeypatch, tmp_path):
    from PIL import Image

    monkeypatch.setattr(server, "AD_MEDIA_DIR", tmp_path)

    async def override_admin():
        return ADMIN

    server.app.dependency_overrides[server.get_current_user] = override_admin
    client = TestClient(server.app)
    image_sources = {}
    for fmt in ("JPEG", "PNG", "WEBP"):
        content = BytesIO()
        Image.new("RGB", (2, 2), color="blue").save(content, format=fmt)
        image_sources[fmt] = content.getvalue()
    media_files = [
        ("promotion.jpg", image_sources["JPEG"], "image/jpeg", "image"),
        ("promotion.jpeg", image_sources["JPEG"], "image/jpeg", "image"),
        ("promotion.png", image_sources["PNG"], "image/png", "image"),
        ("promotion.webp", image_sources["WEBP"], "image/webp", "image"),
        ("promotion.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 8, "video/mp4", "video"),
        ("promotion.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 12, "video/webm", "video"),
    ]
    for filename, content, content_type, expected_type in media_files:
        response = client.post(
            "/api/admin/advertisements/media",
            files={"file": (filename, content, content_type)},
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["media_type"] == expected_type
        assert result["size"] == len(content)
        assert (tmp_path / f"{result['media_id']}.{filename.rsplit('.', 1)[-1]}").is_file()


def test_media_upload_accepts_mp4_signature(fake_db, monkeypatch, tmp_path):
    monkeypatch.setattr(server, "AD_MEDIA_DIR", tmp_path)
    upload = UploadFile(
        file=BytesIO(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 16),
        filename="promotion.mp4",
        headers=Headers({"content-type": "video/mp4"}),
    )
    uploaded = asyncio.run(server.upload_advertisement_media(upload, ADMIN))
    assert uploaded["media_type"] == "video"
    assert (tmp_path / f"{uploaded['media_id']}.mp4").is_file()
    asyncio.run(server.discard_advertisement_media(uploaded["media_id"], ADMIN))


def test_media_upload_rejects_mismatched_type_and_preserves_no_bad_file(fake_db, monkeypatch, tmp_path):
    monkeypatch.setattr(server, "AD_MEDIA_DIR", tmp_path)
    upload = UploadFile(
        file=BytesIO(b"not a png"),
        filename="promotion.png",
        headers=Headers({"content-type": "image/png"}),
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.upload_advertisement_media(upload, ADMIN))
    assert error.value.status_code == 400
    assert list(tmp_path.iterdir()) == []
    assert fake_db.ad_media.documents == []


def test_multipart_upload_reports_invalid_format_clearly(fake_db, monkeypatch, tmp_path):
    monkeypatch.setattr(server, "AD_MEDIA_DIR", tmp_path)

    async def override_admin():
        return ADMIN

    server.app.dependency_overrides[server.get_current_user] = override_admin
    response = TestClient(server.app).post(
        "/api/admin/advertisements/media",
        files={"file": ("promotion.gif", b"GIF89a", "image/gif")},
    )
    assert response.status_code == 400
    assert "JPG, PNG, WebP, MP4, or WebM" in response.json()["detail"]
    assert list(tmp_path.iterdir()) == []


def test_media_upload_enforces_size_limit(fake_db, monkeypatch, tmp_path):
    monkeypatch.setattr(server, "AD_MEDIA_DIR", tmp_path)
    monkeypatch.setattr(server, "AD_IMAGE_LIMIT", 4)
    upload = UploadFile(
        file=BytesIO(b"12345"),
        filename="promotion.jpg",
        headers=Headers({"content-type": "image/jpeg"}),
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.upload_advertisement_media(upload, ADMIN))
    assert error.value.status_code == 413
    assert list(tmp_path.iterdir()) == []


def test_media_upload_rejects_over_configured_image_and_video_limits(fake_db, monkeypatch, tmp_path):
    class GeneratedUpload:
        def __init__(self, filename, content_type, size):
            self.filename = filename
            self.content_type = content_type
            self.remaining = size

        async def read(self, length):
            chunk_size = min(length, self.remaining)
            self.remaining -= chunk_size
            return b"x" * chunk_size

    assert server.AD_IMAGE_LIMIT == 20 * 1024 * 1024
    assert server.AD_VIDEO_LIMIT == 100 * 1024 * 1024
    monkeypatch.setattr(server, "AD_MEDIA_DIR", tmp_path)
    uploads = [
        GeneratedUpload("large.jpg", "image/jpeg", server.AD_IMAGE_LIMIT + 1),
        GeneratedUpload("large.mp4", "video/mp4", server.AD_VIDEO_LIMIT + 1),
    ]
    for upload in uploads:
        with pytest.raises(HTTPException) as error:
            asyncio.run(server.upload_advertisement_media(upload, ADMIN))
        assert error.value.status_code == 413
    assert list(tmp_path.iterdir()) == []
    assert fake_db.ad_media.documents == []


def test_admin_create_publish_and_delete_routes_keep_metrics_history(fake_db):
    async def override_admin():
        return ADMIN

    server.app.dependency_overrides[server.get_current_user] = override_admin
    client = TestClient(server.app)
    payload = campaign_body().model_dump(mode="json")
    response = client.post("/api/admin/advertisements", json=payload)
    assert response.status_code == 200
    advertisement_id = response.json()["advertisement"]["id"]
    assert response.json()["advertisement"]["status"] == "draft"
    assert response.json()["advertisement"]["target_audience"] == "both"
    payload["target_audience"] = "owners"
    updated = client.put(f"/api/admin/advertisements/{advertisement_id}", json=payload)
    assert updated.json()["advertisement"]["target_audience"] == "owners"
    listed = client.get("/api/admin/advertisements").json()["advertisements"]
    assert listed[0]["target_audience"] == "owners"
    assert client.post(
        f"/api/admin/advertisements/{advertisement_id}/status",
        json={"action": "publish"},
    ).json()["advertisement"]["status"] == "active"
    fake_db.advertisement_events.documents.append({
        "id": "event-1",
        "ad_id": advertisement_id,
        "event": "impression",
        "viewer_hash": "anonymous",
    })
    assert client.delete(f"/api/admin/advertisements/{advertisement_id}").status_code == 200
    assert fake_db.advertisement_events.documents[0]["id"] == "event-1"


def test_unauthenticated_admin_route_is_rejected(fake_db):
    response = TestClient(server.app).get("/api/admin/advertisements")
    assert response.status_code == 401
