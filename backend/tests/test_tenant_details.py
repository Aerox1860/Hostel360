import asyncio
import os
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from pymongo.errors import DuplicateKeyError
from pydantic import ValidationError
from starlette.datastructures import Headers
from fastapi.testclient import TestClient
from PIL import Image

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_tenant_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


OWNER = {"id": "owner-1", "role": "owner"}
OTHER_OWNER = {"id": "owner-2", "role": "owner"}
HOSTEL = {
    "id": "hostel-1",
    "owner_id": "owner-1",
    "name": "Test Hostel",
    "trial_ends_at": "2099-01-01T00:00:00+00:00",
}
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def matches(document, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(matches(document, condition) for condition in expected):
                return False
            continue
        actual = document
        for part in key.split("."):
            if isinstance(actual, dict):
                actual = actual.get(part)
            elif isinstance(actual, list):
                actual = [item.get(part) for item in actual if isinstance(item, dict)]
            else:
                actual = None
        if isinstance(expected, dict):
            if "$elemMatch" in expected:
                if not isinstance(actual, list) or not any(matches(item, expected["$elemMatch"]) for item in actual):
                    return False
            elif "$in" in expected:
                if actual not in expected["$in"]:
                    return False
            elif "$ne" in expected:
                if actual == expected["$ne"]:
                    return False
            elif "$exists" in expected:
                if (actual is not None) != expected["$exists"]:
                    return False
            elif "$lt" in expected:
                if actual is None or not actual < expected["$lt"]:
                    return False
            elif "$gt" in expected:
                if actual is None or not actual > expected["$gt"]:
                    return False
            elif "$gte" in expected:
                if actual is None or not actual >= expected["$gte"]:
                    return False
            else:
                return False
        elif actual != expected and not (isinstance(actual, list) and expected in actual):
            return False
    return True


class FakeCollection:
    def __init__(self, documents=None, fail_insert=False, indexes=None, unique_fields=None):
        self.documents = deepcopy(documents or [])
        self.fail_insert = fail_insert
        self.indexes = deepcopy(indexes or {})
        self.created_indexes = []
        self.unique_fields = unique_fields or []

    def find(self, query=None, projection=None):
        documents = [doc for doc in self.documents if matches(doc, query or {})]
        return SimpleNamespace(
            to_list=lambda count: asyncio.sleep(0, result=deepcopy(documents[:count])),
            sort=lambda *_: SimpleNamespace(to_list=lambda count: asyncio.sleep(0, result=deepcopy(documents[:count]))),
        )

    async def find_one(self, query=None, projection=None):
        document = next((doc for doc in self.documents if matches(doc, query or {})), None)
        return deepcopy(document)

    async def count_documents(self, query=None):
        return sum(1 for document in self.documents if matches(document, query or {}))

    async def insert_one(self, document):
        if self.fail_insert:
            raise RuntimeError("injected tenant insert failure")
        if self.unique_fields and any(
            all(existing.get(field) == document.get(field) for field in self.unique_fields)
            for existing in self.documents
        ):
            raise DuplicateKeyError("duplicate test key")
        self.documents.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def insert_many(self, documents, ordered=True):
        self.documents.extend(deepcopy(documents))
        return SimpleNamespace(inserted_ids=[document.get("id") for document in documents])

    async def index_information(self):
        return deepcopy(self.indexes)

    def aggregate(self, pipeline):
        return SimpleNamespace(to_list=lambda count: asyncio.sleep(0, result=[]))

    async def create_index(self, keys, **options):
        self.created_indexes.append((keys, options))
        self.indexes[options.get("name", str(keys))] = {
            "key": [(keys, 1)] if isinstance(keys, str) else keys,
            **options,
        }
        return options.get("name")

    async def delete_one(self, query):
        for index, document in enumerate(self.documents):
            if matches(document, query):
                del self.documents[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def update_one(self, query, update):
        document = next((doc for doc in self.documents if matches(doc, query)), None)
        if document is None:
            return SimpleNamespace(matched_count=0, modified_count=0)
        positional_items = {}
        for key, value in update.get("$set", {}).items():
            if ".$." not in key:
                document[key] = deepcopy(value)
                continue
            array_name, field = key.split(".$.", 1)
            if array_name not in positional_items:
                conditions = query.get(array_name, {}).get("$elemMatch", {})
                positional_items[array_name] = next((entry for entry in document[array_name] if matches(entry, conditions)), None)
            item = positional_items[array_name]
            if item is not None:
                item[field] = deepcopy(value)
        for key, value in update.get("$push", {}).items():
            document.setdefault(key, []).append(deepcopy(value))
        for key, condition in update.get("$pull", {}).items():
            document[key] = [
                item for item in document.get(key, [])
                if not isinstance(item, dict) or not matches(item, condition)
            ]
        for key, value in update.get("$inc", {}).items():
            document[key] = document.get(key, 0) + value
        for key, value in update.get("$addToSet", {}).items():
            entries = document.setdefault(key, [])
            if value not in entries:
                entries.append(deepcopy(value))
        for key in update.get("$unset", {}):
            document.pop(key, None)
        return SimpleNamespace(matched_count=1, modified_count=1)


@pytest.fixture
def tenant_db(monkeypatch, tmp_path):
    room = {
        "id": "room-1",
        "hostel_id": "hostel-1",
        "floor": "Ground",
        "room_number": "101",
        "rent": 5000,
        "beds": [{"bed_number": "1", "status": "available", "tenant_id": None}],
    }
    db = SimpleNamespace(
        hostels=FakeCollection([HOSTEL, {
            **HOSTEL, "id": "hostel-2", "owner_id": "owner-2", "name": "Second Hostel",
        }]),
        rooms=FakeCollection([room, {
            **room,
            "id": "room-2",
            "hostel_id": "hostel-2",
            "room_number": "201",
            "beds": [{"bed_number": "1", "status": "available", "tenant_id": None}],
        }]),
        tenants=FakeCollection(),
        tenant_aadhaar_claims=FakeCollection(unique_fields=["aadhaar_hash"]),
        users=FakeCollection(),
        tenant_document_uploads=FakeCollection(),
        tenant_history_share_codes=FakeCollection(),
        tenant_history_grants=FakeCollection(),
        tenant_reports=FakeCollection(),
        tenant_report_settlements=FakeCollection(),
        tenant_history_audit=FakeCollection(),
        tenant_history_notifications=FakeCollection(),
        tenant_report_evidence=FakeCollection(),
        payments=FakeCollection(),
        rent_payment_evidence=FakeCollection(),
    )
    server.app.dependency_overrides.clear()
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "TENANT_DOCUMENT_DIR", tmp_path)
    monkeypatch.setattr(server, "TENANT_REPORT_EVIDENCE_DIR", tmp_path / "report-evidence")
    monkeypatch.setattr(server, "TENANT_RENT_EVIDENCE_DIR", tmp_path / "rent-evidence")
    monkeypatch.setattr(server, "TENANT_DOCUMENT_ENCRYPTION_KEY", server.Fernet.generate_key().decode())
    monkeypatch.setattr(server, "TENANT_AADHAAR_HMAC_KEY", "test-aadhaar-hmac-key-with-at-least-32-characters")
    yield db
    server.app.dependency_overrides.clear()


def tenant_body(**values):
    defaults = {
        "hostel_id": "hostel-1",
        "name": "  Taylor Tenant  ",
        "mobile": "1234567890",
        "room_id": "room-1",
        "bed_number": "1",
        "joining_date": "2024-04-09",
        "monthly_rent": 5000,
    }
    defaults.update(values)
    return server.TenantBody(**defaults)


def image_bytes(color):
    image = BytesIO()
    Image.new("RGB", (4, 3), color=color).save(image, format="PNG")
    return image.getvalue()


def upload_document(kind, content=PNG_BYTES):
    return asyncio.run(server.upload_tenant_document(
        "hostel-1",
        kind,
        UploadFile(
            filename=f"{kind}.png",
            file=BytesIO(content),
            headers=Headers({"content-type": "image/png"}),
        ),
        OWNER,
    ))


def test_tenant_body_normalizes_date_and_minimizes_aadhaar():
    body = tenant_body(aadhaar_number="1234 5678 9012")
    assert body.name == "Taylor Tenant"
    assert body.joining_date == "2024-04-09"
    assert body.aadhaar_number == "123456789012"
    with pytest.raises(ValidationError):
        tenant_body(joining_date="not-a-date")
    with pytest.raises(ValidationError):
        tenant_body(aadhaar_number="12345")
    with pytest.raises(ValidationError):
        tenant_body(mobile="letters1234567890")


def test_add_tenant_without_selfie_persists_joining_date_and_details(tenant_db):
    created = asyncio.run(server.owner_add_tenant(tenant_body(), OWNER))["tenant"]
    assert created["joining_date"] == "2024-04-09"
    assert tenant_db.rooms.documents[0]["beds"][0]["status"] == "occupied"
    assert "aadhaar_number" not in created
    assert "documents" not in created

    details = asyncio.run(server.owner_get_tenant(created["id"], OWNER))
    assert details["tenant"]["joining_date"] == "2024-04-09"
    assert details["room"] == {"floor": "Ground", "room_number": "101"}
    assert details["documents"] == {}

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_get_tenant(created["id"], OTHER_OWNER))
    assert error.value.status_code == 404


def test_tenant_list_does_not_expose_aadhaar_or_file_references(tenant_db):
    tenant_db.tenants.documents.append({
        "id": "tenant-1",
        "hostel_id": "hostel-1",
        "name": "Taylor Tenant",
        "aadhaar_number": "123456789012",
        "documents": {"aadhaar_front": {"id": "private-upload-id"}},
    })
    response = asyncio.run(server.owner_tenants("hostel-1", OWNER))
    listed = response["tenants"][0]
    assert "aadhaar_number" not in listed
    assert "documents" not in listed
    assert listed["document_status"] == {"aadhaar_front": True}


def test_encrypted_documents_are_bound_to_tenant_and_owner_authorized(tenant_db):
    content_by_kind = {
        "aadhaar_front": image_bytes((220, 30, 20)),
        "aadhaar_back": image_bytes((20, 210, 40)),
        "selfie": image_bytes((30, 40, 220)),
    }
    refs = {
        kind: upload_document(kind, content)["upload_id"]
        for kind, content in content_by_kind.items()
    }
    body = tenant_body(aadhaar_number="123456789012", documents=refs)
    created = asyncio.run(server.owner_add_tenant(body, OWNER))["tenant"]
    stored = tenant_db.tenants.documents[0]
    assert stored["aadhaar_last4"] == "9012"
    assert "aadhaar_number" not in stored
    assert stored["joining_date"] == "2024-04-09"
    assert set(stored["documents"]) == set(refs)
    for record in tenant_db.tenant_document_uploads.documents:
        assert record["tenant_id"] == created["id"]
        assert record["hostel_id"] == created["hostel_id"]
        assert record["owner_id"] == OWNER["id"]
        encrypted_file = (server.TENANT_DOCUMENT_DIR / f'{record["id"]}.{record["extension"]}.enc').read_bytes()
        assert encrypted_file != content_by_kind[record["kind"]]
        assert server._tenant_document_cipher().decrypt(encrypted_file) == content_by_kind[record["kind"]]

    async def authenticated_owner():
        return OWNER

    server.app.dependency_overrides[server.get_current_user] = authenticated_owner
    client = TestClient(server.app)
    for kind, expected_content in content_by_kind.items():
        response = client.get(f"/api/owner/tenants/{created['id']}/documents/{kind}")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("image/png")
        assert response.headers["cache-control"] == "private, no-store"
        assert response.content == expected_content
        with Image.open(BytesIO(response.content)) as actual_image:
            actual_image.load()
            assert actual_image.size == (4, 3)
            assert actual_image.format == "PNG"

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_get_tenant_document(created["id"], "aadhaar_front", OTHER_OWNER))
    assert error.value.status_code == 404


def test_aadhaar_registration_is_globally_unique_and_discloses_only_hostel(tenant_db):
    first = asyncio.run(server.owner_add_tenant(
        tenant_body(aadhaar_number="1234 5678 9012"), OWNER
    ))["tenant"]
    assert "aadhaar_number" not in first
    assert "aadhaar_lookup_hash" not in tenant_db.tenants.documents[0]
    assert tenant_db.tenant_aadhaar_claims.documents[0]["hostel_id"] == "hostel-1"
    assert tenant_db.tenant_aadhaar_claims.documents[0]["aadhaar_hash"] != "123456789012"

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_add_tenant(
            tenant_body(hostel_id="hostel-2", room_id="room-2", aadhaar_number="123456789012"),
            OTHER_OWNER,
        ))
    assert error.value.status_code == 409
    assert error.value.detail == "This Aadhaar number is already registered with hostel: Test Hostel."
    assert len(tenant_db.tenants.documents) == 1
    assert tenant_db.rooms.documents[1]["beds"][0]["status"] == "available"


def test_aadhaar_preflight_is_owner_scoped_and_reports_only_duplicate_hostel(tenant_db):
    asyncio.run(server.owner_add_tenant(tenant_body(aadhaar_number="123456789012"), OWNER))

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_check_tenant_aadhaar(
            server.TenantAadhaarCheckBody(aadhaar_number="1234-5678-9012"),
            "hostel-2",
            OTHER_OWNER,
        ))
    assert error.value.status_code == 409
    assert error.value.detail == "This Aadhaar number is already registered with hostel: Test Hostel."

    available = asyncio.run(server.owner_check_tenant_aadhaar(
        server.TenantAadhaarCheckBody(aadhaar_number="999999999999"),
        "hostel-2",
        OTHER_OWNER,
    ))
    assert available == {"available": True}

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_check_tenant_aadhaar(
            server.TenantAadhaarCheckBody(aadhaar_number="123456789012"),
            "hostel-1",
            OTHER_OWNER,
        ))
    assert error.value.status_code == 404


def test_aadhaar_preflight_api_requires_owner_auth_and_returns_minimal_result(tenant_db):
    async def authenticated_owner():
        return OWNER

    server.app.dependency_overrides[server.get_current_user] = authenticated_owner
    client = TestClient(server.app)
    available = client.post(
        "/api/owner/tenants/check-aadhaar?hostel_id=hostel-1",
        json={"aadhaar_number": "999999999999"},
    )
    assert available.status_code == 200
    assert available.json() == {"available": True}

    asyncio.run(server.owner_add_tenant(tenant_body(aadhaar_number="123456789012"), OWNER))
    duplicate = client.post(
        "/api/owner/tenants/check-aadhaar?hostel_id=hostel-1",
        json={"aadhaar_number": "123456789012"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json() == {
        "detail": "This Aadhaar number is already registered with hostel: Test Hostel."
    }


def test_concurrent_cross_hostel_aadhaar_registration_has_one_winner(tenant_db):
    async def register_both():
        return await asyncio.gather(
            server.owner_add_tenant(
                tenant_body(aadhaar_number="123456789012"), OWNER
            ),
            server.owner_add_tenant(
                tenant_body(hostel_id="hostel-2", room_id="room-2", aadhaar_number="123456789012"),
                OTHER_OWNER,
            ),
            return_exceptions=True,
        )

    results = asyncio.run(register_both())
    assert sum(isinstance(result, dict) for result in results) == 1
    failures = [result for result in results if isinstance(result, HTTPException)]
    assert len(failures) == 1
    assert failures[0].status_code == 409
    assert len(tenant_db.tenants.documents) == 1
    assert len(tenant_db.tenant_aadhaar_claims.documents) == 1


def test_legacy_aadhaar_migration_preserves_tenants_and_reports_duplicates(tenant_db, caplog):
    tenant_db.tenants.documents.extend([
        {"id": "legacy-1", "hostel_id": "hostel-1", "aadhaar_number": "123456789012", "name": "One"},
        {"id": "legacy-2", "hostel_id": "hostel-2", "aadhaar": "1234 5678 9012", "name": "Two"},
        {"id": "legacy-last-four", "hostel_id": "hostel-1", "aadhaar_last4": "9012", "name": "Three"},
    ])

    asyncio.run(server._ensure_tenant_aadhaar_claim_index())

    assert len(tenant_db.tenants.documents) == 3
    assert tenant_db.tenant_aadhaar_claims.created_indexes[0][1]["unique"] is True
    assert tenant_db.tenant_aadhaar_claims.created_indexes[0][1]["name"] == "tenant_aadhaar_global_unique"
    assert all("aadhaar_number" not in entry and "aadhaar" not in entry for entry in tenant_db.tenants.documents)
    assert len(tenant_db.tenant_aadhaar_claims.documents) == 1
    assert "Legacy Aadhaar duplicate requires manual review" in caplog.text
    assert "cannot identify 1 legacy tenant records" in caplog.text


def test_legacy_last_four_match_is_blocked_for_manual_verification(tenant_db):
    tenant_db.tenants.documents.append({
        "id": "legacy-last-four",
        "hostel_id": "hostel-1",
        "aadhaar_last4": "9012",
        "name": "Legacy Tenant",
    })

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_check_tenant_aadhaar(
            server.TenantAadhaarCheckBody(aadhaar_number="123456789012"),
            "hostel-2",
            OTHER_OWNER,
        ))
    assert error.value.status_code == 409
    assert "may already be registered with hostel: Test Hostel" in error.value.detail
    assert "Verify the legacy record" in error.value.detail


def test_aadhaar_duplicate_check_requires_key_and_valid_input(tenant_db, monkeypatch):
    monkeypatch.setattr(server, "TENANT_AADHAAR_HMAC_KEY", "")
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_check_tenant_aadhaar(
            server.TenantAadhaarCheckBody(aadhaar_number="123456789012"),
            "hostel-1",
            OWNER,
        ))
    assert error.value.status_code == 503
    with pytest.raises(ValidationError):
        server.TenantAadhaarCheckBody(aadhaar_number="12345")


def _rent_test_setup(tenant_db):
    tenant_db.tenants.documents.append({
        "id": "rent-tenant-1",
        "user_id": "tenant-user-1",
        "hostel_id": "hostel-1",
        "name": "Taylor Tenant",
        "room_id": "room-1",
        "active": True,
        "monthly_rent": 5000,
        "payment_status": "due",
    })
    tenant_db.hostels.documents[0]["upi_id"] = "hostel@upi"
    return {"id": "tenant-user-1", "role": "tenant"}


def _rent_submission(**values):
    defaults = {
        "amount": 2500,
        "payment_date": "2026-10-25",
        "upi_reference": "UPI123456789",
        "method": "phonepe",
    }
    defaults.update(values)
    return server.TenantRentPaymentBody(**defaults)


def test_legacy_rent_checkout_no_longer_calls_stripe(tenant_db, monkeypatch):
    monkeypatch.setattr(server, "STRIPE_API_KEY", "")
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.rent_checkout(server.RentCheckoutBody(), {"id": "tenant-user-1", "role": "tenant"}))
    assert error.value.status_code == 410
    assert "manual UPI" in error.value.detail


def test_tenant_cannot_submit_without_hostel_upi_configuration(tenant_db):
    tenant_user = _rent_test_setup(tenant_db)
    tenant_db.hostels.documents[0].pop("upi_id")
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.tenant_submit_rent_payment(_rent_submission(), tenant_user))
    assert error.value.status_code == 409
    assert not tenant_db.payments.documents


def test_upi_reference_index_is_compatible_or_fails_without_dropping(tenant_db):
    asyncio.run(server._ensure_tenant_upi_reference_index())
    assert tenant_db.payments.created_indexes[-1][1]["name"] == "tenant_upi_reference"

    tenant_db.payments.indexes["tenant_upi_reference"] = {
        "key": [("tenant_id", 1), ("upi_reference", 1)],
        "unique": False,
    }
    with pytest.raises(RuntimeError, match="incompatible definition"):
        asyncio.run(server._ensure_tenant_upi_reference_index())
    assert tenant_db.payments.indexes["tenant_upi_reference"]["unique"] is False


def test_tenant_upi_payment_waits_for_owner_and_approval_is_idempotent(tenant_db):
    tenant_user = _rent_test_setup(tenant_db)
    submitted = asyncio.run(server.tenant_submit_rent_payment(_rent_submission(), tenant_user))["payment"]
    assert submitted["status"] == "pending_owner_approval"
    owner_notifications = [
        notification for notification in tenant_db.tenant_history_notifications.documents
        if notification.get("recipient_role") == "owner"
    ]
    assert len(owner_notifications) == 1
    assert owner_notifications[0]["recipient_user_id"] == OWNER["id"]
    assert owner_notifications[0]["hostel_id"] == "hostel-1"
    assert owner_notifications[0]["payment_id"] == submitted["id"]
    assert owner_notifications[0]["tenant_name"] == "Taylor Tenant"
    assert owner_notifications[0]["room_number"] == "101"
    assert owner_notifications[0]["amount"] == 2500
    assert owner_notifications[0]["method"] == "phonepe"
    assert owner_notifications[0]["upi_reference"] == "UPI123456789"
    assert owner_notifications[0]["status"] == "pending_owner_approval"
    assert owner_notifications[0]["payment_submitted_at"] == submitted["created_at"]
    owner_alerts = asyncio.run(server._user_history_notifications(OWNER, "owner", "hostel-1"))
    assert owner_alerts["pending_payment_count"] == 1
    with pytest.raises(HTTPException) as unrelated_owner:
        asyncio.run(server._user_history_notifications(OTHER_OWNER, "owner", "hostel-1"))
    assert unrelated_owner.value.status_code == 404
    assert "receipt_no" not in submitted
    assert tenant_db.tenants.documents[0]["payment_status"] == "due"
    assert tenant_db.tenants.documents[0].get("rent_balance") is None

    with pytest.raises(HTTPException) as duplicate:
        asyncio.run(server.tenant_submit_rent_payment(_rent_submission(upi_reference="NEW123456789"), tenant_user))
    assert duplicate.value.status_code == 409

    first = asyncio.run(server.owner_approve_rent_payment(submitted["id"], OWNER))
    receipt_no = first["payment"]["receipt_no"]
    assert first["payment"]["status"] == "paid"
    assert tenant_db.tenants.documents[0]["rent_balance"] == 2500
    assert tenant_db.tenants.documents[0]["payment_status"] == "due"

    overpayment = {
        "id": server.new_id(),
        "hostel_id": "hostel-1",
        "tenant_id": "rent-tenant-1",
        "tenant_user_id": tenant_user["id"],
        "tenant_name": "Taylor Tenant",
        "amount": 3000,
        "type": "rent",
        "status": "pending_owner_approval",
    }
    tenant_db.payments.documents.append(overpayment)
    with pytest.raises(HTTPException) as excessive:
        asyncio.run(server.owner_approve_rent_payment(overpayment["id"], OWNER))
    assert excessive.value.status_code == 409
    assert tenant_db.tenants.documents[0]["rent_balance"] == 2500

    second = asyncio.run(server.owner_approve_rent_payment(submitted["id"], OWNER))
    assert second["already_approved"] is True
    assert second["payment"]["receipt_no"] == receipt_no
    assert tenant_db.tenants.documents[0]["rent_balance"] == 2500
    assert tenant_db.tenants.documents[0]["applied_rent_payment_ids"] == [submitted["id"]]
    assert any(row.get("action") == "rent_payment_approved" for row in tenant_db.tenant_history_audit.documents)
    assert any(row.get("event") == "rent_payment_approved" for row in tenant_db.tenant_history_notifications.documents)
    updated_owner_alert = next(
        row for row in tenant_db.tenant_history_notifications.documents
        if row.get("recipient_role") == "owner" and row.get("payment_id") == submitted["id"]
    )
    assert updated_owner_alert["status"] == "paid"
    assert updated_owner_alert["event"] == "rent_payment_approved"


def test_tenant_upi_rejection_requires_reason_and_does_not_update_rent(tenant_db):
    tenant_user = _rent_test_setup(tenant_db)
    payment = asyncio.run(server.tenant_submit_rent_payment(_rent_submission(), tenant_user))["payment"]
    with pytest.raises(ValidationError):
        server.RejectRentPaymentBody(reason="  ")
    rejected = asyncio.run(server.owner_reject_rent_payment(
        payment["id"], server.RejectRentPaymentBody(reason="Reference was not found in bank records"), OWNER,
    ))["payment"]
    assert rejected["status"] == "rejected"
    assert rejected["rejection_reason"] == "Reference was not found in bank records"
    assert tenant_db.tenants.documents[0]["payment_status"] == "due"
    assert tenant_db.tenants.documents[0].get("rent_balance") is None
    assert any(row.get("event") == "rent_payment_rejected" for row in tenant_db.tenant_history_notifications.documents)
    owner_alert = next(
        row for row in tenant_db.tenant_history_notifications.documents
        if row.get("recipient_role") == "owner" and row.get("payment_id") == payment["id"]
    )
    assert owner_alert["status"] == "rejected"
    assert owner_alert["rejection_reason"] == "Reference was not found in bank records"
    with pytest.raises(HTTPException) as duplicate_reference:
        asyncio.run(server.tenant_submit_rent_payment(_rent_submission(), tenant_user))
    assert duplicate_reference.value.status_code == 409


def test_owner_collected_partial_rent_updates_remaining_balance(tenant_db):
    _rent_test_setup(tenant_db)
    result = asyncio.run(server.owner_collect_rent(
        server.RentBody(tenant_id="rent-tenant-1", amount=1000, method="cash"), OWNER,
    ))
    assert result["payment"]["status"] == "paid"
    assert tenant_db.tenants.documents[0]["rent_balance"] == 4000
    assert tenant_db.tenants.documents[0]["payment_status"] == "due"


def test_tenant_upi_screenshot_is_encrypted_and_owner_scoped(tenant_db):
    tenant_user = _rent_test_setup(tenant_db)
    raw = image_bytes((40, 80, 160))
    payload = _rent_submission(
        screenshot_data=f"data:image/png;base64,{server.base64.b64encode(raw).decode()}",
        screenshot_name="confirmation.png",
        screenshot_content_type="image/png",
    )
    payment = asyncio.run(server.tenant_submit_rent_payment(payload, tenant_user))["payment"]
    evidence = tenant_db.rent_payment_evidence.documents[0]
    encrypted_path = server._rent_evidence_path(evidence)
    assert encrypted_path.read_bytes() != raw
    response = asyncio.run(server.owner_get_rent_payment_evidence(payment["id"], OWNER))
    assert response.body == raw
    with pytest.raises(HTTPException) as unauthorized:
        asyncio.run(server.owner_get_rent_payment_evidence(payment["id"], OTHER_OWNER))
    assert unauthorized.value.status_code == 404


def test_failed_tenant_insert_releases_bed_and_staged_document(tenant_db):
    uploaded = upload_document("aadhaar_front")
    tenant_db.tenants.fail_insert = True
    with pytest.raises(RuntimeError, match="injected"):
        asyncio.run(server.owner_add_tenant(tenant_body(documents={"aadhaar_front": uploaded["upload_id"]}), OWNER))
    assert tenant_db.rooms.documents[0]["beds"][0]["status"] == "available"
    assert tenant_db.rooms.documents[0]["beds"][0]["tenant_id"] is None
    assert tenant_db.tenant_document_uploads.documents[0]["tenant_id"] is None
    assert not tenant_db.tenants.documents


def test_tenant_document_upload_rejects_non_image_data(tenant_db):
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.upload_tenant_document(
            "hostel-1",
            "aadhaar_front",
            UploadFile(
                filename="not-image.png",
                file=BytesIO(b"not an image"),
                headers=Headers({"content-type": "image/png"}),
            ),
            OWNER,
        ))
    assert error.value.status_code == 400
    assert not tenant_db.tenant_document_uploads.documents


def test_tenant_document_upload_enforces_ten_megabyte_limit(tenant_db):
    payload = b"\xff\xd8\xff" + b"\x00" * server.TENANT_DOCUMENT_MAX_SIZE
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.upload_tenant_document(
            "hostel-1",
            "aadhaar_front",
            UploadFile(
                filename="oversized.jpg",
                file=BytesIO(payload),
                headers=Headers({"content-type": "image/jpeg"}),
            ),
            OWNER,
        ))
    assert error.value.status_code == 413
    assert not tenant_db.tenant_document_uploads.documents


def test_staged_tenant_document_upload_is_hostel_scoped(tenant_db):
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.upload_tenant_document(
            "hostel-1",
            "aadhaar_front",
            UploadFile(
                filename="front.png",
                file=BytesIO(PNG_BYTES),
                headers=Headers({"content-type": "image/png"}),
            ),
            OTHER_OWNER,
        ))
    assert error.value.status_code == 404


def test_registered_multipart_endpoint_uploads_and_rejects_unauthorized_or_invalid_requests(tenant_db):
    client = TestClient(server.app)
    url = "/api/owner/tenant-documents?hostel_id=hostel-1&kind=aadhaar_front"
    files = {"file": ("front.png", PNG_BYTES, "image/png")}

    assert client.post(url, files=files).status_code == 401

    async def authenticated_owner():
        return OWNER

    server.app.dependency_overrides[server.get_current_user] = authenticated_owner
    uploaded = client.post(url, files=files)
    assert uploaded.status_code == 200, uploaded.text
    result = uploaded.json()
    assert set(result) == {"upload_id", "kind", "size"}
    assert result["kind"] == "aadhaar_front"
    assert result["size"] == len(PNG_BYTES)
    assert tenant_db.tenant_document_uploads.documents[0]["hostel_id"] == "hostel-1"

    invalid_kind = client.post(
        "/api/owner/tenant-documents?hostel_id=hostel-1&kind=unknown",
        files=files,
    )
    assert invalid_kind.status_code == 400
    invalid_content = client.post(
        url,
        files={"file": ("front.png", b"not-image-data", "image/png")},
    )
    assert invalid_content.status_code == 400


def test_registered_upload_endpoint_rejects_owner_without_hostel_permission(tenant_db):
    async def authenticated_other_owner():
        return OTHER_OWNER

    server.app.dependency_overrides[server.get_current_user] = authenticated_other_owner
    response = TestClient(server.app).post(
        "/api/owner/tenant-documents?hostel_id=hostel-1&kind=aadhaar_front",
        files={"file": ("front.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 404
    assert not tenant_db.tenant_document_uploads.documents


def _global_tenant_account(db, *, consented=False):
    account = {
        "id": "tenant-user-1",
        "email": "tenant@example.com",
        "role": "tenant",
        "global_history_consented": consented,
    }
    db.users.documents.append(account)
    return account


def _membership(db, *, tenant_id="tenant-1", user_id="tenant-user-1", active=True):
    membership = {
        "id": tenant_id,
        "hostel_id": "hostel-1",
        "user_id": user_id,
        "name": "Taylor Tenant",
        "email": "tenant@example.com",
        "room_id": "room-1",
        "bed_number": "1",
        "monthly_rent": 5000,
        "active": active,
    }
    db.tenants.documents.append(membership)
    return membership


def test_global_history_requires_authentication(tenant_db):
    client = TestClient(server.app)
    assert client.get("/api/tenant/global-history/consent").status_code == 401
    assert client.get("/api/tenant/global-history/reports").status_code == 401
    assert client.post("/api/owner/tenant-history/lookup", json={"code": "x" * 24}).status_code == 401
    assert client.post(
        "/api/owner/tenants/tenant-1/reports",
        json={"category": "rent", "title": "Rent", "description": "Unpaid", "amount_claimed": 10},
    ).status_code == 401
    assert client.post(
        "/api/owner/tenant-history/automatic-lookup",
        json={"email": "tenant@example.com"},
    ).status_code == 401
    assert client.get("/api/owner/tenant-history/notifications").status_code == 401
    assert client.get("/api/tenant/global-history/notifications").status_code == 401
    assert client.post(
        "/api/owner/tenant-reports/report-1/evidence",
        files={"file": ("evidence.pdf", b"%PDF-1.7", "application/pdf")},
    ).status_code == 401


def test_consent_share_code_one_time_lookup_grant_and_grant_binding(tenant_db):
    account = _global_tenant_account(tenant_db)
    _membership(tenant_db)
    report = {
        "id": "report-1", "tenant_user_id": account["id"], "tenant_id": "old-membership",
        "hostel_id": "old-hostel", "category": "unpaid_rent", "title": "Rent balance",
        "description": "Rent balance details", "amount_claimed": 100, "outstanding_balance": 100,
        "status": "reported_pending_verification",
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    tenant_db.tenant_reports.documents.append(report)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.tenant_create_global_history_share_code({"id": account["id"], "role": "tenant"}))
    assert error.value.status_code == 409

    tenant_db.users.documents[0]["global_history_consented"] = False
    asyncio.run(server.tenant_set_global_history_consent(
        server.TenantHistoryConsentBody(consented=True),
        {"id": account["id"], "role": "tenant"},
    ))
    result = asyncio.run(server.tenant_create_global_history_share_code({"id": account["id"], "role": "tenant"}))
    assert result["expires_at"]
    lookup = asyncio.run(server.owner_lookup_tenant_history(
        server.TenantHistoryLookupBody(code=result["code"]), None, OWNER
    ))
    assert lookup["reports"] == [{
        "id": "report-1", "previous_hostel": None, "category": "unpaid_rent",
        "status": "reported_pending_verification", "amount": 100, "amount_claimed": 100,
        "outstanding_balance": 100, "reported_at": "2026-01-01T00:00:00+00:00",
        "created_at": "2026-01-01T00:00:00+00:00", "updated_at": None,
        "evidence_summary": None, "evidence_documents": [],
        "details_available": True, "details": "Rent balance details",
        "tenant_response": None, "stay_start_date": None, "vacated_at": None,
        "resolved_at": None, "resolution_details": None,
    }]
    grant = tenant_db.tenant_history_grants.documents[0]
    assert grant["owner_id"] == OWNER["id"]
    assert grant["hostel_id"] == HOSTEL["id"]
    assert grant["tenant_user_id"] == account["id"]
    granted_detail = asyncio.run(server.owner_get_tenant_history_report(
        "report-1", lookup["grant_id"], OWNER
    ))
    assert granted_detail["report"]["id"] == "report-1"
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_get_tenant_history_report("report-1", None, OTHER_OWNER))
    assert error.value.status_code == 404

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_lookup_tenant_history(
            server.TenantHistoryLookupBody(code=result["code"]), None, OWNER
        ))
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_add_tenant(tenant_body(email="tenant@example.com"), OWNER))
    assert error.value.status_code == 409
    tenant_db.tenants.documents.clear()
    created = asyncio.run(server.owner_add_tenant(
        tenant_body(history_grant_id=lookup["grant_id"], email="tenant@example.com"),
        OWNER,
    ))["tenant"]
    assert tenant_db.tenants.documents[-1]["user_id"] == account["id"]
    assert tenant_db.tenant_history_grants.documents[0]["membership_id"] == created["id"]
    assert tenant_db.tenant_history_grants.documents[0]["membership_used_at"]
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_add_tenant(
            tenant_body(history_grant_id=lookup["grant_id"], email="tenant@example.com"),
            OWNER,
        ))
    assert error.value.status_code == 409


def test_share_code_and_grants_expire_and_cannot_be_replayed(tenant_db):
    account = _global_tenant_account(tenant_db)
    code = "safe-test-code-that-is-long-enough"
    tenant_db.tenant_history_share_codes.documents.append({
        "id": "expired-code",
        "code_hash": server._history_code_hash(code),
        "tenant_user_id": account["id"],
        "expires_at": "2000-01-01T00:00:00+00:00",
        "used_at": None,
    })
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_lookup_tenant_history(server.TenantHistoryLookupBody(code=code), None, OWNER))
    assert error.value.status_code == 404
    tenant_db.tenant_history_grants.documents.append({
        "id": "expired-grant", "owner_id": OWNER["id"], "hostel_id": HOSTEL["id"],
        "tenant_user_id": account["id"], "expires_at": "2000-01-01T00:00:00+00:00",
    })
    assert asyncio.run(server._valid_history_grant("expired-grant", OWNER["id"], HOSTEL["id"])) is None


def test_history_grant_is_bound_to_owner_and_hostel(tenant_db):
    account = _global_tenant_account(tenant_db, consented=True)
    tenant_db.tenant_history_grants.documents.append({
        "id": "other-owner-grant",
        "owner_id": OTHER_OWNER["id"],
        "hostel_id": HOSTEL["id"],
        "tenant_user_id": account["id"],
        "expires_at": (server.now_utc() + server.timedelta(minutes=5)).isoformat(),
        "membership_used_at": None,
    })
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_add_tenant(
            tenant_body(history_grant_id="other-owner-grant"),
            OWNER,
        ))
    assert error.value.status_code == 409
    assert tenant_db.rooms.documents[0]["beds"][0]["status"] == "available"
    assert not tenant_db.tenants.documents


def test_reports_disputes_settlements_duplicate_prevention_and_report_privacy(tenant_db):
    account = _global_tenant_account(tenant_db)
    membership = _membership(tenant_db)
    body = server.TenantReportBody(
        category="unpaid_rent", title="Unpaid rent", description="Rent balance due", amount_claimed=900
    )
    created = asyncio.run(server.owner_create_tenant_report(membership["id"], body, OWNER))["report"]
    report_id = created["id"]
    tenant_reports = asyncio.run(server.tenant_global_history_reports(
        {"id": account["id"], "role": "tenant"}
    ))
    assert len(tenant_reports["reports"]) == 1
    assert tenant_reports["reports"][0]["status"] == "reported_pending_verification"
    assert tenant_reports["reports"][0]["details"] == "Rent balance due"
    owner_reports = asyncio.run(server.owner_get_tenant_reports(membership["id"], OWNER))
    assert len(owner_reports["reports"]) == 1
    assert owner_reports["reports"][0]["outstanding_balance"] == 900
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_create_tenant_report(membership["id"], body, OWNER))
    assert error.value.status_code == 409

    status_response = asyncio.run(server.owner_update_tenant_report_status(
        report_id, server.TenantReportStatusBody(status="under_review"), OWNER
    ))
    assert status_response["report"]["status"] == "under_review"
    response = asyncio.run(server.tenant_respond_to_global_history_report(
        report_id,
        server.TenantReportResponseBody(response="I dispute this amount."),
        {"id": account["id"], "role": "tenant"},
    ))
    assert response["status"] == "disputed_by_tenant"
    assert tenant_db.tenant_reports.documents[0]["tenant_response"]["text"] == "I dispute this amount."

    first_settlement = asyncio.run(server.owner_record_tenant_report_settlement(
        report_id, server.TenantReportSettlementBody(amount=350, note="Part payment"), OWNER
    ))
    assert first_settlement["outstanding_balance"] == 550
    assert first_settlement["status"] == "partially_settled"
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_record_tenant_report_settlement(
            report_id, server.TenantReportSettlementBody(amount=551), OWNER
        ))
    assert error.value.status_code == 409
    final_settlement = asyncio.run(server.owner_record_tenant_report_settlement(
        report_id, server.TenantReportSettlementBody(amount=550), OWNER
    ))
    assert final_settlement["outstanding_balance"] == 0
    assert final_settlement["status"] == "resolved_paid"
    assert sum(row["amount"] for row in tenant_db.tenant_report_settlements.documents) == 900
    event_names = {item["event"] for item in tenant_db.tenant_history_notifications.documents}
    assert {
        "report_submitted",
        "report_status_updated",
        "report_disputed",
        "report_settlement_updated",
        "report_resolved",
    }.issubset(event_names)

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_update_tenant_report_status(
            report_id, server.TenantReportStatusBody(status="reported_pending_verification"), OTHER_OWNER
        ))
    assert error.value.status_code == 404

    detail = asyncio.run(server.owner_get_tenant_history_report(report_id, None, OWNER))
    assert detail["report"]["status"] == "resolved_paid"
    assert "reporter_user_id" not in detail["report"]
    assert "tenant_user_id" not in detail["report"]
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_get_tenant_history_report(report_id, None, OTHER_OWNER))
    assert error.value.status_code == 404


def test_closed_membership_and_payments_are_preserved(tenant_db):
    membership = _membership(tenant_db)
    tenant_db.payments = FakeCollection([{
        "id": "payment-1", "tenant_id": membership["id"], "hostel_id": "hostel-1", "amount": 5000,
    }])
    asyncio.run(server.owner_delete_tenant(membership["id"], OWNER))
    assert tenant_db.tenants.documents[0]["active"] is False
    assert tenant_db.tenants.documents[0]["deleted_at"]
    assert tenant_db.payments.documents[0]["id"] == "payment-1"
    assert asyncio.run(server.owner_tenants("hostel-1", OWNER))["tenants"] == []


def test_checkout_is_idempotent_and_does_not_free_a_reassigned_bed(tenant_db):
    membership = _membership(tenant_db)
    tenant_db.rooms.documents[0]["beds"][0].update({
        "status": "occupied",
        "tenant_id": membership["id"],
    })

    first = asyncio.run(server.owner_checkout_tenant(membership["id"], OWNER))
    assert first == {"ok": True, "already_checked_out": False}
    assert tenant_db.tenants.documents[0]["active"] is False
    assert tenant_db.rooms.documents[0]["beds"][0]["status"] == "available"

    tenant_db.rooms.documents[0]["beds"][0].update({
        "status": "occupied",
        "tenant_id": "new-tenant",
    })
    second = asyncio.run(server.owner_checkout_tenant(membership["id"], OWNER))
    assert second == {"ok": True, "already_checked_out": True}
    assert tenant_db.rooms.documents[0]["beds"][0]["tenant_id"] == "new-tenant"


def test_transfer_updates_both_beds_and_rejects_occupied_destination(tenant_db):
    membership = _membership(tenant_db)
    tenant_db.rooms.documents.append({
        **tenant_db.rooms.documents[0],
        "id": "room-3",
        "room_number": "301",
        "beds": [{"bed_number": "1", "status": "available", "tenant_id": None}],
    })
    tenant_db.rooms.documents[0]["beds"][0].update({
        "status": "occupied",
        "tenant_id": membership["id"],
    })
    result = asyncio.run(server.owner_transfer_tenant(
        membership["id"],
        server.TransferBody(room_id="room-3", bed_number="1"),
        OWNER,
    ))

    assert result["tenant"]["room_id"] == "room-3"
    assert tenant_db.rooms.documents[0]["beds"][0]["status"] == "available"
    assert tenant_db.rooms.documents[2]["beds"][0]["tenant_id"] == membership["id"]
    _membership(tenant_db, tenant_id="tenant-2", user_id="tenant-user-2")
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_transfer_tenant(
            "tenant-2",
            server.TransferBody(room_id="room-3", bed_number="1"),
            OWNER,
        ))
    assert error.value.status_code == 400


def test_tenant_query_indexes_are_created_without_replacing_existing_indexes(tenant_db):
    tenant_db.tenants.indexes["tenant_hostel_created"] = {
        "key": [("other_field", 1)],
    }
    asyncio.run(server._ensure_tenant_query_indexes())

    assert tenant_db.tenants.created_indexes == [
        ([("id", 1)], {"name": "tenant_id_lookup"}),
        ([("hostel_id", 1), ("created_at", -1)], {"name": "tenant_hostel_created_scoped"}),
    ]


def test_dismissing_report_writes_off_allegation_and_closes_balance(tenant_db):
    _global_tenant_account(tenant_db)
    membership = _membership(tenant_db)
    report = asyncio.run(server.owner_create_tenant_report(
        membership["id"],
        server.TenantReportBody(
            category="property_damage", title="Damage claim", description="Claimed damage", amount_claimed=250
        ),
        OWNER,
    ))["report"]
    dismissed = asyncio.run(server.owner_update_tenant_report_status(
        report["id"], server.TenantReportStatusBody(status="rejected"), OWNER
    ))
    assert dismissed["report"]["status"] == "rejected"
    assert dismissed["report"]["outstanding_balance"] == 0
    ledger = tenant_db.tenant_report_settlements.documents[0]
    assert ledger["entry_type"] == "write_off"
    assert ledger["amount"] == 250
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_update_tenant_report_status(
            report["id"], server.TenantReportStatusBody(status="reported_pending_verification"), OWNER
        ))
    assert error.value.status_code == 409


def test_automatic_history_lookup_requires_google_verification_and_separate_consent(tenant_db):
    account = _global_tenant_account(tenant_db, consented=True)
    tenant_db.tenant_reports.documents.append({
        "id": "old-report",
        "tenant_user_id": account["id"],
        "tenant_id": "old-membership",
        "hostel_id": "old-hostel",
        "category": "unpaid_rent",
        "amount_claimed": 15000,
        "status": "reported_pending_verification",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    body = server.TenantHistoryAutomaticLookupBody(email=" Tenant@Example.com ")

    result = asyncio.run(server.owner_automatic_tenant_history_lookup(body, "hostel-1", OWNER))
    assert result == {"grant_id": None, "reports": []}

    tenant_db.users.documents[0]["global_history_auto_lookup_consented"] = True
    result = asyncio.run(server.owner_automatic_tenant_history_lookup(body, "hostel-1", OWNER))
    assert result == {"grant_id": None, "reports": []}

    tenant_db.users.documents[0].update({
        "google_sub": "verified-google-subject",
        "google_identity_verified_at": "2026-01-01T00:00:00+00:00",
    })
    result = asyncio.run(server.owner_automatic_tenant_history_lookup(body, "hostel-1", OWNER))
    assert result["grant_id"]
    assert len(result["reports"]) == 1
    assert result["reports"][0]["previous_hostel"] is None
    grant = tenant_db.tenant_history_grants.documents[-1]
    assert grant["access_mode"] == "automatic"
    assert asyncio.run(server._valid_history_grant(grant["id"], OWNER["id"], HOSTEL["id"])) == grant


def test_automatic_history_lookup_is_bound_to_hostel_and_prevents_duplicate_membership(tenant_db):
    account = _global_tenant_account(tenant_db, consented=True)
    account.update({
        "global_history_auto_lookup_consented": True,
        "google_sub": "verified-google-subject",
        "google_identity_verified_at": "2026-01-01T00:00:00+00:00",
    })
    result = asyncio.run(server.owner_automatic_tenant_history_lookup(
        server.TenantHistoryAutomaticLookupBody(email=account["email"]), "hostel-1", OWNER
    ))
    tenant = asyncio.run(server.owner_add_tenant(
        tenant_body(email=account["email"], history_grant_id=result["grant_id"]), OWNER
    ))["tenant"]
    assert tenant_db.tenants.documents[-1]["user_id"] == account["id"]
    assert tenant_db.tenants.documents[-1]["identity_guarded"] is True
    assert tenant["id"] == tenant_db.tenant_history_grants.documents[-1]["membership_id"]
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_automatic_tenant_history_lookup(
            server.TenantHistoryAutomaticLookupBody(email=account["email"]), "hostel-1", OWNER
        ))
    assert error.value.status_code == 409


def test_active_membership_access_requires_continuing_consent(tenant_db):
    account = _global_tenant_account(tenant_db, consented=True)
    account.update({
        "global_history_auto_lookup_consented": True,
        "google_sub": "verified-google-subject",
        "google_identity_verified_at": "2026-01-01T00:00:00+00:00",
    })
    membership = _membership(tenant_db)
    report = {
        "id": "previous-report",
        "tenant_user_id": account["id"],
        "tenant_id": "old-membership",
        "hostel_id": "old-hostel",
        "category": "unpaid_rent",
        "amount_claimed": 1000,
        "status": "reported_pending_verification",
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    tenant_db.tenant_reports.documents.append(report)
    result = asyncio.run(server.owner_get_tenant_history_report(report["id"], None, OWNER))
    assert result["report"]["id"] == report["id"]

    tenant_db.users.documents[0]["global_history_auto_lookup_consented"] = False
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_get_tenant_history_report(report["id"], None, OWNER))
    assert error.value.status_code == 404


def test_concurrent_tenant_registration_lock_rejects_second_request(tenant_db):
    account = _global_tenant_account(tenant_db, consented=True)
    account["membership_registration_lock_id"] = "in-progress-registration"
    account["membership_registration_lock_at"] = server.now_utc()
    tenant_db.tenant_history_grants.documents.append({
        "id": "share-grant",
        "owner_id": OWNER["id"],
        "hostel_id": HOSTEL["id"],
        "tenant_user_id": account["id"],
        "expires_at": server.now_utc() + server.timedelta(minutes=5),
        "membership_used_at": None,
    })

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_add_tenant(
            tenant_body(history_grant_id="share-grant", email=account["email"]),
            OWNER,
        ))
    assert error.value.status_code == 409
    assert tenant_db.rooms.documents[0]["beds"][0]["status"] == "available"
    assert tenant_db.tenants.documents == []


def test_report_evidence_is_encrypted_and_authorized(tenant_db, tmp_path):
    membership = _membership(tenant_db)
    report = asyncio.run(server.owner_create_tenant_report(
        membership["id"],
        server.TenantReportBody(
            category="unpaid_rent", title="Rent", description="Rent due", amount_claimed=500
        ),
        OWNER,
    ))["report"]
    image = BytesIO()
    Image.new("RGB", (4, 4), color="green").save(image, format="PNG")
    upload = UploadFile(
        filename="rent-evidence.png",
        file=BytesIO(image.getvalue()),
        headers=Headers({"content-type": "image/png"}),
    )
    result = asyncio.run(server.upload_tenant_report_evidence(report["id"], upload, OWNER))
    evidence = tenant_db.tenant_report_evidence.documents[0]
    assert result["evidence"]["filename"] == "rent-evidence.png"
    assert evidence["content_type"] == "image/png"
    assert b"\x89PNG" not in server._tenant_report_evidence_path(evidence).read_bytes()
    assert tenant_db.tenant_history_audit.documents[-1]["action"] == "report_evidence_uploaded"

    response = asyncio.run(server.get_tenant_report_evidence(
        report["id"], evidence["id"], None, OWNER
    ))
    assert response.body == image.getvalue()
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.get_tenant_report_evidence(
            report["id"], evidence["id"], None, OTHER_OWNER
        ))
    assert error.value.status_code == 404


def test_report_events_create_private_owner_and_tenant_notifications(tenant_db):
    account = _global_tenant_account(tenant_db)
    membership = _membership(tenant_db)
    report = asyncio.run(server.owner_create_tenant_report(
        membership["id"],
        server.TenantReportBody(
            category="unpaid_rent", title="Rent", description="Rent due", amount_claimed=500
        ),
        OWNER,
    ))["report"]
    owner_alerts = asyncio.run(server.owner_tenant_history_notifications(OWNER))
    tenant_alerts = asyncio.run(server.tenant_global_history_notifications(
        {"id": account["id"], "role": "tenant"}
    ))
    assert owner_alerts["notifications"][0]["event"] == "report_submitted"
    assert tenant_alerts["notifications"][0]["report_id"] == report["id"]

    notification_id = tenant_alerts["notifications"][0]["id"]
    asyncio.run(server.mark_tenant_history_notification_read(
        notification_id, {"id": account["id"], "role": "tenant"}
    ))
    assert next(
        item for item in tenant_db.tenant_history_notifications.documents if item["id"] == notification_id
    )["read_at"]
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.mark_tenant_history_notification_read(
            notification_id, {"id": "unrelated-user", "role": "tenant"}
        ))
    assert error.value.status_code == 404


def test_duplicate_report_index_check_preserves_existing_index_and_records(tenant_db):
    existing_reports = FakeCollection(
        [{"id": "legacy-report", "duplicate_key": "existing"}],
        indexes={
            "tenant_report_duplicate": {
                "key": [("duplicate_key", 1)],
                "unique": True,
            },
        },
    )
    tenant_db.tenant_reports = existing_reports
    asyncio.run(server._ensure_tenant_report_duplicate_index())
    assert existing_reports.documents == [{"id": "legacy-report", "duplicate_key": "existing"}]
    assert existing_reports.created_indexes == []


def test_duplicate_report_index_name_conflict_uses_new_name_without_dropping(tenant_db):
    existing_reports = FakeCollection(
        [{"id": "legacy-report", "duplicate_key": "existing"}],
        indexes={"tenant_report_duplicate": {"key": [("other_key", 1)], "unique": True}},
    )
    tenant_db.tenant_reports = existing_reports
    asyncio.run(server._ensure_tenant_report_duplicate_index())
    assert "tenant_report_duplicate" in existing_reports.indexes
    assert existing_reports.created_indexes[0][1]["name"] == "tenant_report_duplicate_scoped"
    assert existing_reports.documents == [{"id": "legacy-report", "duplicate_key": "existing"}]


def test_guarded_active_memberships_get_a_partial_unique_index(tenant_db):
    asyncio.run(server._ensure_tenant_active_identity_index())
    keys, options = tenant_db.tenants.created_indexes[0]
    assert keys == [("hostel_id", 1), ("user_id", 1)]
    assert options["unique"] is True
    assert options["partialFilterExpression"]["identity_guarded"] is True
    assert options["name"] == "tenant_active_global_membership"
