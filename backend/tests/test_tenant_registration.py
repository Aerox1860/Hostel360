import asyncio
import os
import sys
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_tenant_registration_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from test_tenant_details import (
    FakeCollection,
    HOSTEL,
    OTHER_OWNER,
    OWNER,
    tenant_db,
)


BASE_URL = "https://apply.example.test"
APPLICATION_FIELDS = {
    "name": "  Taylor Applicant ",
    "mobile": "(123) 456-7890",
    "email": "taylor@example.com",
    "address": "  12 Main Road ",
    "joining_date": "2026-07-01",
    "preferences": "  Single sharing ",
}


def run(coroutine):
    return asyncio.run(coroutine)


def request_from(ip="203.0.113.8"):
    return SimpleNamespace(client=SimpleNamespace(host=ip))


def registration_token(token="opaque-registration-token", **values):
    return {
        "id": "registration-token-id",
        "token": token,
        "owner_id": OWNER["id"],
        "hostel_id": HOSTEL["id"],
        "active": True,
        "created_at": server.now_utc().isoformat(),
        "expires_at": None,
        **values,
    }


class ActiveTokenCollection(FakeCollection):
    def __init__(self):
        super().__init__(unique_fields=["id", "token"])
        self.insert_count = 0
        self.insert_barrier = None

    async def insert_one(self, document):
        if self.insert_barrier:
            self.insert_count += 1
            if self.insert_count == 2:
                self.insert_barrier.set()
            await self.insert_barrier.wait()
        if any(
            item.get("hostel_id") == document.get("hostel_id") and item.get("active") is True
            for item in self.documents
        ):
            raise DuplicateKeyError("One active token per hostel")
        return await super().insert_one(document)

    async def update_many(self, query, update):
        matched = []
        for item in self.documents:
            if all(item.get(key) == value for key, value in query.items()):
                item.update(deepcopy(update.get("$set", {})))
                matched.append(item)
        return SimpleNamespace(matched_count=len(matched), modified_count=len(matched))


class ApplicationCollection(FakeCollection):
    def __init__(self):
        super().__init__(unique_fields=["id", "duplicate_key"])
        self.insert_count = 0
        self.insert_barrier = None

    async def insert_one(self, document):
        if self.insert_barrier:
            self.insert_count += 1
            if self.insert_count == 2:
                self.insert_barrier.set()
            await self.insert_barrier.wait()
        if any(
            item.get("duplicate_key") == document.get("duplicate_key")
            for item in self.documents
            if document.get("duplicate_key")
        ):
            raise DuplicateKeyError("Active application for mobile already exists")
        return await super().insert_one(document)


class RateLimitCollection(FakeCollection):
    async def update_one(self, query, update, upsert=False):
        document = next((doc for doc in self.documents if doc.get("id") == query.get("id")), None)
        if document is None and upsert:
            document = deepcopy(query)
            document.update(deepcopy(update.get("$setOnInsert", {})))
            document.update(deepcopy(update.get("$set", {})))
            document.update(deepcopy(update.get("$inc", {})))
            self.documents.append(document)
            return SimpleNamespace(matched_count=0, modified_count=1)
        if document is None:
            return SimpleNamespace(matched_count=0, modified_count=0)
        for key, value in update.get("$inc", {}).items():
            document[key] = document.get(key, 0) + value
        for key, value in update.get("$set", {}).items():
            document[key] = deepcopy(value)
        return SimpleNamespace(matched_count=1, modified_count=1)


@pytest.fixture
def registration_db(tenant_db, monkeypatch):
    tenant_db.tenant_registration_tokens = ActiveTokenCollection()
    tenant_db.tenant_applications = ApplicationCollection()
    tenant_db.tenant_application_rate_limits = RateLimitCollection()
    monkeypatch.setattr(server, "PUBLIC_REGISTRATION_BASE_URL", BASE_URL)
    return tenant_db


def submit_application(db, token="opaque-registration-token", ip="203.0.113.8", **overrides):
    body = server.PublicTenantApplicationBody(**{**APPLICATION_FIELDS, **overrides})
    return run(server.public_submit_tenant_application(body, request_from(ip), token))


def test_qr_generation_is_permanent_and_reuses_the_same_token(registration_db):
    first = run(server.owner_create_tenant_registration_qr(HOSTEL["id"], OWNER))["registration"]
    second = run(server.owner_create_tenant_registration_qr(HOSTEL["id"], OWNER))["registration"]
    displayed = run(server.owner_get_tenant_registration_qr(HOSTEL["id"], OWNER))["registration"]

    assert first["id"] == second["id"] == displayed["id"]
    assert first["registration_url"] == second["registration_url"] == displayed["registration_url"]
    assert first["expires_at"] is None
    assert first["permanent"] is True
    assert first["qr_data_uri"].startswith("data:image/png;base64,")
    saved = registration_db.tenant_registration_tokens.documents
    assert len(saved) == 1
    assert saved[0]["token"] in first["registration_url"]
    assert saved[0]["expires_at"] is None


@pytest.mark.parametrize(
    "expiry",
    [
        "2000-01-01T00:00:00+00:00",
        None,
        "missing",
    ],
)
def test_existing_active_qr_is_valid_regardless_of_expiry(registration_db, expiry):
    document = registration_token()
    if expiry == "missing":
        document.pop("expires_at")
    else:
        document["expires_at"] = expiry
    registration_db.tenant_registration_tokens.documents.append(deepcopy(document))

    hostel = run(server.public_tenant_registration(document["token"]))["hostel"]
    qr = run(server.owner_get_tenant_registration_qr(HOSTEL["id"], OWNER))["registration"]

    assert hostel["id"] == HOSTEL["id"]
    assert qr["id"] == document["id"]
    assert qr["expires_at"] is None
    assert registration_db.tenant_registration_tokens.documents[0] == document


def test_revoke_invalidates_qr_and_next_generate_uses_new_token(registration_db):
    first = run(server.owner_create_tenant_registration_qr(HOSTEL["id"], OWNER))["registration"]
    assert run(server.owner_revoke_tenant_registration_qr(HOSTEL["id"], OWNER)) == {"revoked": True}

    with pytest.raises(HTTPException) as error:
        run(server.public_tenant_registration(first["registration_url"].split("token=", 1)[1]))
    assert error.value.status_code == 404

    replacement = run(server.owner_create_tenant_registration_qr(HOSTEL["id"], OWNER))["registration"]
    assert replacement["id"] != first["id"]
    assert replacement["registration_url"] != first["registration_url"]
    assert len([
        token for token in registration_db.tenant_registration_tokens.documents
        if token["active"]
    ]) == 1


def test_owner_isolation_blocks_foreign_qr_and_application_access(registration_db):
    registration_db.tenant_registration_tokens.documents.append(registration_token())

    with pytest.raises(HTTPException) as error:
        run(server.owner_get_tenant_registration_qr(HOSTEL["id"], OTHER_OWNER))
    assert error.value.status_code == 404

    app = submit_application(registration_db)["application"]
    with pytest.raises(HTTPException) as error:
        run(server.owner_tenant_applications(HOSTEL["id"], OTHER_OWNER))
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        run(server.owner_update_tenant_application(
            app["id"],
            server.TenantApplicationReviewBody(status="approved"),
            OTHER_OWNER,
        ))
    assert error.value.status_code == 404


@pytest.mark.parametrize(
    ("base_url", "detail"),
    [
        ("", "Set PUBLIC_REGISTRATION_BASE_URL"),
        ("javascript:alert(1)", "absolute HTTP(S) origin"),
        ("https://apply.example.test/path", "without a path"),
        ("https://apply.example.test/?token=oops", "without a path"),
        ("https://apply.example.test:invalid", "absolute HTTP(S) origin"),
    ],
)
def test_qr_generation_rejects_missing_or_invalid_base_url(registration_db, monkeypatch, base_url, detail):
    monkeypatch.setattr(server, "PUBLIC_REGISTRATION_BASE_URL", base_url)

    with pytest.raises(HTTPException) as error:
        run(server.owner_create_tenant_registration_qr(HOSTEL["id"], OWNER))

    assert error.value.status_code == 503
    assert detail in error.value.detail
    assert registration_db.tenant_registration_tokens.documents == []


def test_concurrent_qr_generation_creates_only_one_active_token(registration_db):
    tokens = registration_db.tenant_registration_tokens
    tokens.insert_barrier = asyncio.Event()

    async def generate():
        return await asyncio.gather(
            server.owner_create_tenant_registration_qr(HOSTEL["id"], OWNER),
            server.owner_create_tenant_registration_qr(HOSTEL["id"], OWNER),
        )

    first, second = run(generate())

    assert first["registration"]["id"] == second["registration"]["id"]
    assert len([item for item in tokens.documents if item["active"]]) == 1


def test_public_application_is_validated_stored_pending_and_duplicate_protected(registration_db):
    registration_db.tenant_registration_tokens.documents.append(registration_token())

    response = submit_application(registration_db)["application"]

    assert response["status"] == "pending"
    assert response["name"] == "Taylor Applicant"
    assert response["mobile"] == "1234567890"
    assert response["address"] == "12 Main Road"
    assert response["joining_date"] == "2026-07-01"
    assert response["preferences"] == "Single sharing"
    assert registration_db.tenants.documents == []
    with pytest.raises(HTTPException) as error:
        submit_application(registration_db)
    assert error.value.status_code == 409
    with pytest.raises(ValidationError):
        server.PublicTenantApplicationBody(**{**APPLICATION_FIELDS, "mobile": "bad"})
    with pytest.raises(ValidationError):
        server.PublicTenantApplicationBody(**{
            **APPLICATION_FIELDS,
            "joining_date": "2026-07-01garbage",
        })


def test_public_application_rate_limit_is_enforced(registration_db):
    registration_db.tenant_registration_tokens.documents.append(registration_token())

    for index in range(server.TENANT_APPLICATION_RATE_LIMIT):
        submit_application(
            registration_db,
            mobile=f"12345678{index:02d}",
        )
    with pytest.raises(HTTPException) as error:
        submit_application(registration_db, mobile="9876543210")

    assert error.value.status_code == 429
    assert len(registration_db.tenant_applications.documents) == server.TENANT_APPLICATION_RATE_LIMIT


def test_concurrent_duplicate_application_submission_is_serialized(registration_db):
    registration_db.tenant_registration_tokens.documents.append(registration_token())
    applications = registration_db.tenant_applications
    applications.insert_barrier = asyncio.Event()
    body = server.PublicTenantApplicationBody(**APPLICATION_FIELDS)

    async def submit_concurrently():
        return await asyncio.gather(
            server.public_submit_tenant_application(body, request_from(), "opaque-registration-token"),
            server.public_submit_tenant_application(body, request_from("203.0.113.9"), "opaque-registration-token"),
            return_exceptions=True,
        )

    results = run(submit_concurrently())

    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, HTTPException) for result in results) == 1
    assert len(applications.documents) == 1


def test_public_submission_requires_active_token_and_correct_hostel_owner(registration_db):
    with pytest.raises(HTTPException) as error:
        submit_application(registration_db)
    assert error.value.status_code == 404

    invalid_hostel_token = registration_token()
    invalid_hostel_token["owner_id"] = OTHER_OWNER["id"]
    registration_db.tenant_registration_tokens.documents.append(invalid_hostel_token)
    with pytest.raises(HTTPException) as error:
        submit_application(registration_db)
    assert error.value.status_code == 410


def test_owner_can_approve_or_reject_pending_application(registration_db):
    registration_db.tenant_registration_tokens.documents.append(registration_token())
    approved = submit_application(registration_db)["application"]
    rejected = submit_application(registration_db, ip="203.0.113.9", mobile="9876543210")["application"]

    approval = run(server.owner_update_tenant_application(
        approved["id"],
        server.TenantApplicationReviewBody(status="approved"),
        OWNER,
    ))
    rejection = run(server.owner_update_tenant_application(
        rejected["id"],
        server.TenantApplicationReviewBody(status="rejected"),
        OWNER,
    ))

    assert approval["application"]["status"] == "approved"
    assert rejection["application"]["status"] == "rejected"
    assert "duplicate_key" not in rejection["application"]
    assert registration_db.tenants.documents == []


def test_allocation_reuses_existing_tenant_creation_and_is_retry_safe(registration_db):
    registration_db.tenant_registration_tokens.documents.append(registration_token())
    application = submit_application(registration_db)["application"]
    run(server.owner_update_tenant_application(
        application["id"],
        server.TenantApplicationReviewBody(status="approved"),
        OWNER,
    ))
    registration_db.tenants.fail_insert = True
    body = server.TenantApplicationAllocationBody(room_id="room-1", bed_number="1")

    with pytest.raises(RuntimeError, match="injected tenant insert failure"):
        run(server.owner_allocate_tenant_application(application["id"], body, OWNER))
    assert registration_db.tenant_applications.documents[0]["status"] == "approved"
    assert registration_db.rooms.documents[0]["beds"][0]["status"] == "available"
    assert registration_db.tenants.documents == []

    registration_db.tenants.fail_insert = False
    allocated = run(server.owner_allocate_tenant_application(application["id"], body, OWNER))
    tenant = registration_db.tenants.documents[0]

    assert allocated["application"]["status"] == "allocated"
    assert allocated["tenant"]["id"] == tenant["id"]
    assert tenant["tenant_application_id"] == application["id"]
    assert tenant["monthly_rent"] == 5000
    assert registration_db.rooms.documents[0]["beds"][0]["tenant_id"] == tenant["id"]
    assert len(registration_db.tenants.documents) == 1

    retried = run(server.owner_allocate_tenant_application(application["id"], body, OWNER))
    assert retried["tenant"]["id"] == tenant["id"]
    assert len(registration_db.tenants.documents) == 1


def test_allocation_rejects_occupied_bed_and_can_retry_with_another_bed(registration_db):
    registration_db.tenant_registration_tokens.documents.append(registration_token())
    application = submit_application(registration_db)["application"]
    run(server.owner_update_tenant_application(
        application["id"],
        server.TenantApplicationReviewBody(status="approved"),
        OWNER,
    ))
    registration_db.rooms.documents[0]["beds"][0].update({"status": "occupied", "tenant_id": "other-tenant"})

    with pytest.raises(HTTPException) as error:
        run(server.owner_allocate_tenant_application(
            application["id"],
            server.TenantApplicationAllocationBody(room_id="room-1", bed_number="1"),
            OWNER,
        ))
    assert error.value.status_code == 400
    assert registration_db.tenant_applications.documents[0]["status"] == "approved"
    assert registration_db.tenants.documents == []

    registration_db.rooms.documents[0]["beds"].append(
        {"bed_number": "2", "status": "available", "tenant_id": None}
    )
    allocated = run(server.owner_allocate_tenant_application(
        application["id"],
        server.TenantApplicationAllocationBody(room_id="room-1", bed_number="2"),
        OWNER,
    ))
    assert allocated["application"]["status"] == "allocated"
    assert allocated["tenant"]["bed_number"] == "2"


def test_concurrent_application_allocation_creates_one_tenant(registration_db):
    registration_db.tenant_registration_tokens.documents.append(registration_token())
    application = submit_application(registration_db)["application"]
    run(server.owner_update_tenant_application(
        application["id"],
        server.TenantApplicationReviewBody(status="approved"),
        OWNER,
    ))
    body = server.TenantApplicationAllocationBody(room_id="room-1", bed_number="1")

    async def allocate():
        return await asyncio.gather(
            server.owner_allocate_tenant_application(application["id"], body, OWNER),
            server.owner_allocate_tenant_application(application["id"], body, OWNER),
            return_exceptions=True,
        )

    results = run(allocate())

    assert all(isinstance(result, dict) for result in results)
    assert results[0]["tenant"]["id"] == results[1]["tenant"]["id"]
    assert len(registration_db.tenants.documents) == 1


def test_tenant_registration_routes_and_indexes_are_registered(registration_db):
    routes = {
        (method, route.path)
        for route in server.app.routes
        for method in getattr(route, "methods", set())
    }
    assert ("GET", "/api/owner/tenant-registration-qr") in routes
    assert ("POST", "/api/owner/tenant-registration-qr") in routes
    assert ("DELETE", "/api/owner/tenant-registration-qr") in routes
    assert ("GET", "/api/public/tenant-registration") in routes
    assert ("POST", "/api/public/tenant-applications") in routes
    assert ("GET", "/api/owner/tenant-applications") in routes
    assert ("PUT", "/api/owner/tenant-applications/{application_id}") in routes
    assert ("POST", "/api/owner/tenant-applications/{application_id}/allocation") in routes

    run(server._ensure_tenant_registration_indexes())
    run(server._ensure_tenant_registration_indexes())
    token_indexes = {options["name"] for _, options in registration_db.tenant_registration_tokens.created_indexes}
    application_indexes = {options["name"] for _, options in registration_db.tenant_applications.created_indexes}
    assert "tenant_registration_token_id" in token_indexes
    assert "tenant_registration_token_value" in token_indexes
    assert "tenant_registration_one_active_per_hostel" in token_indexes
    assert "tenant_application_id" in application_indexes
    assert "tenant_application_owner_hostel_created" in application_indexes
    assert "tenant_application_active_mobile" in application_indexes
