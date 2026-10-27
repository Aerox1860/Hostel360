import asyncio
import json
import os
import sys
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_rules_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


OWNER = {"id": "owner-1", "role": "owner"}
OTHER_OWNER = {"id": "owner-2", "role": "owner"}
TENANT_USER = {
    "id": "tenant-user-1",
    "role": "tenant",
    "email": "tenant@example.test",
    "hostel_id": "hostel-1",
}
HOSTELS = [
    {"id": "hostel-1", "owner_id": "owner-1", "name": "Owned Hostel"},
    {"id": "hostel-2", "owner_id": "owner-2", "name": "Other Hostel"},
]


def matches(document, query):
    for key, expected in query.items():
        actual = document
        for part in key.split("."):
            if isinstance(actual, dict):
                actual = actual.get(part)
            else:
                actual = None
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and ((actual is not None) != expected["$exists"]):
                return False
        elif actual != expected and not (isinstance(actual, list) and expected in actual):
            return False
    return True


class Cursor:
    def __init__(self, documents):
        self.documents = deepcopy(documents)

    def sort(self, field, direction=1):
        self.documents.sort(key=lambda item: item.get(field) or "", reverse=direction < 0)
        return self

    async def to_list(self, count):
        return deepcopy(self.documents[:count])


class FakeCollection:
    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])

    def find(self, query=None, projection=None):
        return Cursor([item for item in self.documents if matches(item, query or {})])

    async def find_one(self, query=None, projection=None):
        item = next((item for item in self.documents if matches(item, query or {})), None)
        return deepcopy(item)

    async def insert_one(self, document):
        self.documents.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update, upsert=False):
        document = next((item for item in self.documents if matches(item, query)), None)
        if document is None and upsert:
            document = dict(query)
            for key, value in update.get("$setOnInsert", {}).items():
                document[key] = deepcopy(value)
            self.documents.append(document)
        if document is None:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        for key, value in update.get("$set", {}).items():
            document[key] = deepcopy(value)
        for key, value in update.get("$pull", {}).items():
            if isinstance(document.get(key), list):
                document[key] = [item for item in document[key] if item != value]
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    async def delete_one(self, query):
        for index, item in enumerate(self.documents):
            if matches(item, query):
                del self.documents[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def count_documents(self, query):
        return sum(1 for item in self.documents if matches(item, query))


@pytest.fixture
def rules_db(monkeypatch, tmp_path):
    db = SimpleNamespace(
        hostels=FakeCollection(HOSTELS),
        tenants=FakeCollection([
            {
                "id": "tenant-1",
                "user_id": "tenant-user-1",
                "email": "tenant@example.test",
                "hostel_id": "hostel-1",
                "name": "A Tenant",
                "room_number": "101",
                "bed_number": "2",
                "active": True,
            },
            {
                "id": "tenant-2",
                "user_id": "tenant-user-2",
                "email": "other@example.test",
                "hostel_id": "hostel-1",
                "name": "B Tenant",
                "room_number": "102",
                "bed_number": "1",
                "active": True,
            },
            {
                "id": "former-tenant",
                "user_id": "former-user",
                "hostel_id": "hostel-1",
                "name": "Former Tenant",
                "active": False,
            },
        ]),
        rules_image_uploads=FakeCollection(),
        rule_drafts=FakeCollection(),
        rules_policies=FakeCollection(),
        rule_acknowledgements=FakeCollection(),
    )
    server.app.dependency_overrides.clear()
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "RULE_IMAGE_DIR", tmp_path)
    monkeypatch.setattr(server, "TENANT_DOCUMENT_ENCRYPTION_KEY", server.Fernet.generate_key().decode())
    yield db
    server.app.dependency_overrides.clear()


def client_for(user):
    async def current_user():
        return user

    server.app.dependency_overrides[server.get_current_user] = current_user
    return TestClient(server.app)


def publish(client, text, hostel_id="hostel-1"):
    return client.post(
        "/api/owner/rules/publish",
        json={"hostel_id": hostel_id, "text": text, "source_image_ids": []},
    )


def png_bytes():
    output = BytesIO()
    Image.new("RGB", (10, 10), color="white").save(output, format="PNG")
    return output.getvalue()


def test_ocr_preprocessing_corrects_exif_orientation_and_creates_readability_variants():
    output = BytesIO()
    image = Image.new("RGB", (4000, 1000), color="white")
    exif = image.getexif()
    exif[274] = 6
    image.save(output, format="JPEG", exif=exif)

    variants = server._prepare_rules_ocr_images(output.getvalue())

    assert len(variants) >= 2
    with Image.open(BytesIO(variants[0])) as normalized:
        assert normalized.size[0] < normalized.size[1]
        assert max(normalized.size) <= 3072
    assert all(Image.open(BytesIO(variant)).format == "PNG" for variant in variants)


def test_rules_original_image_is_private_and_hostel_authorized(rules_db):
    client = client_for(OWNER)
    content = png_bytes()
    uploaded = client.post(
        "/api/owner/rules/images?hostel_id=hostel-1",
        files={"file": ("rules.png", content, "image/png")},
    ).json()

    original = client.get(f"/api/owner/rules/images/{uploaded['upload_id']}")
    unauthorized = client_for(OTHER_OWNER).get(
        f"/api/owner/rules/images/{uploaded['upload_id']}"
    )

    assert original.status_code == 200
    assert original.content == content
    assert original.headers["content-type"] == "image/png"
    assert original.headers["cache-control"] == "private, no-store"
    assert unauthorized.status_code == 404


def test_publish_versions_are_hostel_scoped_and_idempotent(rules_db):
    client = client_for(OWNER)
    first = publish(client, "Quiet hours are from 10 PM to 6 AM.")
    retry = publish(client, "Quiet hours are from 10 PM to 6 AM.")
    second = publish(client, "Quiet hours are from 11 PM to 6 AM.")

    assert first.status_code == retry.status_code == second.status_code == 200
    assert first.json()["policy"]["version"] == retry.json()["policy"]["version"] == 1
    assert retry.json()["already_published"] is True
    assert second.json()["policy"]["version"] == 2
    assert second.json()["policy"]["owner_id"] == OWNER["id"]
    assert second.json()["policy"]["created_at"] == second.json()["policy"]["published_at"]
    assert len(rules_db.rules_policies.documents) == 2
    assert len(rules_db.rule_drafts.documents) == 1


def test_owner_cannot_publish_or_read_another_hostels_rules(rules_db):
    client = client_for(OWNER)
    assert publish(client, "Hostel one policy", hostel_id="hostel-2").status_code == 404
    assert client.get("/api/owner/rules?hostel_id=hostel-2").status_code == 404
    assert client.get("/api/owner/rules/acknowledgements?hostel_id=hostel-2").status_code == 404
    assert not rules_db.rules_policies.documents


def test_tenant_must_acknowledge_current_policy_and_cannot_choose_tenant_id(rules_db):
    owner_client = client_for(OWNER)
    first = publish(owner_client, "Version one").json()["policy"]
    tenant_client = client_for(TENANT_USER)

    pending = tenant_client.get("/api/tenant/rules/pending").json()
    assert pending["required"] is True
    assert pending["policy"]["id"] == first["id"]

    acknowledgement = tenant_client.post(
        "/api/tenant/rules/acknowledge",
        json={"policy_id": first["id"], "tenant_id": "tenant-2"},
    )
    assert acknowledgement.status_code == 200
    assert acknowledgement.json()["acknowledgement"]["tenant_id"] == "tenant-1"
    assert acknowledgement.json()["acknowledgement"]["policy_version"] == 1
    assert tenant_client.post(
        "/api/tenant/rules/acknowledge",
        json={"policy_id": first["id"]},
    ).json()["already_acknowledged"] is True
    assert len(rules_db.rule_acknowledgements.documents) == 1
    assert tenant_client.get("/api/tenant/rules/pending").json()["required"] is False

    owner_client = client_for(OWNER)
    second = publish(owner_client, "Version two").json()["policy"]
    tenant_client = client_for(TENANT_USER)
    pending_update = tenant_client.get("/api/tenant/rules/pending").json()
    assert second["version"] == 2
    assert pending_update["required"] is True
    assert pending_update["policy"]["id"] == second["id"]
    assert tenant_client.post(
        "/api/tenant/rules/acknowledge",
        json={"policy_id": first["id"]},
    ).status_code == 409


def test_acknowledgement_requires_active_membership(rules_db):
    publish(client_for(OWNER), "Current rules")
    unassigned = {**TENANT_USER, "id": "unassigned", "email": "none@example.test", "hostel_id": None}
    response = client_for(unassigned).post(
        "/api/tenant/rules/acknowledge",
        json={"policy_id": rules_db.rules_policies.documents[0]["id"]},
    )
    assert response.status_code == 403
    assert not rules_db.rule_acknowledgements.documents


def test_owner_report_counts_current_status_and_keeps_history(rules_db):
    owner_client = client_for(OWNER)
    first = publish(owner_client, "Version one").json()["policy"]
    client_for(TENANT_USER).post("/api/tenant/rules/acknowledge", json={"policy_id": first["id"]})
    owner_client = client_for(OWNER)
    publish(owner_client, "Version two")

    report = owner_client.get("/api/owner/rules/acknowledgements?hostel_id=hostel-1").json()
    assert report["total_active_tenants"] == 2
    assert report["acknowledged_count"] == 0
    assert report["pending_count"] == 2
    assert {row["status"] for row in report["tenants"]} == {"Pending"}
    assert len(report["history"]) == 1
    assert report["history"][0]["policy_version"] == 1


def test_rule_image_upload_is_private_encrypted_and_validated(rules_db):
    client = client_for(OWNER)
    content = png_bytes()
    response = client.post(
        "/api/owner/rules/images?hostel_id=hostel-1",
        files={"file": ("rules.png", content, "image/png")},
    )
    assert response.status_code == 200
    upload = response.json()
    record = rules_db.rules_image_uploads.documents[0]
    encrypted_file = server._rules_image_path(record)
    assert upload["upload_id"] == record["id"]
    assert record["hostel_id"] == "hostel-1"
    assert encrypted_file.read_bytes() != content
    assert record["sha256"] == server.hashlib.sha256(content).hexdigest()
    assert "url" not in upload
    invalid = client.post(
        "/api/owner/rules/images?hostel_id=hostel-1",
        files={"file": ("rules.txt", b"not an image", "text/plain")},
    )
    assert invalid.status_code == 400
    assert client_for(OTHER_OWNER).post(
        "/api/owner/rules/images?hostel_id=hostel-1",
        files={"file": ("rules.png", content, "image/png")},
    ).status_code == 404


def test_ocr_uses_only_uploaded_images_owned_by_this_hostel(rules_db, monkeypatch):
    client = client_for(OWNER)
    uploaded = client.post(
        "/api/owner/rules/images?hostel_id=hostel-1",
        files={"file": ("rules.png", png_bytes(), "image/png")},
    ).json()
    calls = []

    async def fake_ocr(images):
        calls.extend(images)
        return {"text": "1. Keep the kitchen clean.", "uncertain_sections": ["kitchen"]}

    monkeypatch.setattr(server, "_request_rules_ocr", fake_ocr)
    extracted = client.post(
        "/api/owner/rules/ocr",
        json={"hostel_id": "hostel-1", "upload_ids": [uploaded["upload_id"]]},
    )
    assert extracted.status_code == 200
    assert extracted.json()["text"] == "1. Keep the kitchen clean."
    assert extracted.json()["uncertain_sections"] == ["kitchen"]
    assert calls[0][0] == "image/png"
    assert calls[0][1] == png_bytes()
    assert not rules_db.rules_policies.documents
    assert rules_db.rule_drafts.documents[0]["text"] == "1. Keep the kitchen clean."
    assert rules_db.rule_drafts.documents[0]["source_image_ids"] == [uploaded["upload_id"]]

    unauthorized = client_for(OTHER_OWNER).post(
        "/api/owner/rules/ocr",
        json={"hostel_id": "hostel-1", "upload_ids": [uploaded["upload_id"]]},
    )
    assert unauthorized.status_code == 404


def test_ocr_configuration_failure_is_explicit(monkeypatch):
    monkeypatch.setattr(server, "RULES_OCR_API_KEY", "")
    with pytest.raises(server.HTTPException) as error:
        asyncio.run(server._request_rules_ocr([("image/png", png_bytes())]))
    assert error.value.status_code == 503
    assert "GOOGLE_GENAI_API_KEY" in error.value.detail


def test_ocr_service_request_keeps_key_out_of_url_and_returns_verbatim_draft(monkeypatch):
    monkeypatch.setattr(server, "RULES_OCR_API_KEY", "test-key")
    calls = []

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "text": '{"text":"Meal time: 7:30 AM","uncertain_sections":["7:30 AM"]}',
                        }],
                    },
                }],
            }

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            calls.append({"timeout": kwargs["timeout"]})

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            calls.append({"url": url, "headers": headers, "body": json})
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeAsyncClient)
    result = asyncio.run(server._request_rules_ocr([("image/png", png_bytes())]))

    assert result == {
        "text": "Meal time: 7:30 AM",
        "uncertain_sections": ["Image 1: 7:30 AM"],
    }
    assert calls[1]["url"].endswith("gemini-2.5-flash:generateContent")
    assert "test-key" not in calls[1]["url"]
    assert calls[1]["headers"] == {"x-goog-api-key": "test-key"}
    assert calls[1]["body"]["generationConfig"]["temperature"] == 0


def test_ocr_service_timeout_is_reported_for_retry(monkeypatch):
    monkeypatch.setattr(server, "RULES_OCR_API_KEY", "test-key")

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            raise server.httpx.ReadTimeout("timeout")

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeAsyncClient)
    with pytest.raises(server.HTTPException) as error:
        asyncio.run(server._request_rules_ocr([("image/png", png_bytes())]))

    assert error.value.status_code == 504
    assert "timed out" in error.value.detail


def test_ocr_endpoint_processes_multiple_images_in_order_and_saves_combined_draft(rules_db, monkeypatch):
    monkeypatch.setattr(server, "RULES_OCR_API_KEY", "test-key")
    client = client_for(OWNER)
    first_upload = client.post(
        "/api/owner/rules/images?hostel_id=hostel-1",
        files={"file": ("page-1.png", png_bytes(), "image/png")},
    ).json()
    second_upload = client.post(
        "/api/owner/rules/images?hostel_id=hostel-1",
        files={"file": ("page-2.png", png_bytes(), "image/png")},
    ).json()
    responses = iter([
        "1. Monthly rent: Rs. 5,000",
        "2. భోజన సమయం: ఉదయం 8:00",
    ])
    request_bodies = []

    class FakeResponse:
        status_code = 200

        def __init__(self, page_text):
            self.page_text = page_text

        def json(self):
            return {
                "candidates": [{
                    "finishReason": "STOP",
                    "content": {
                        "parts": [{
                            "text": json.dumps({
                                "text": self.page_text,
                                "uncertain_sections": [],
                            }),
                        }],
                    },
                }],
            }

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            assert kwargs["timeout"].read == 45.0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            request_bodies.append(json)
            return FakeResponse(next(responses))

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeAsyncClient)
    extracted = client.post(
        "/api/owner/rules/ocr",
        json={
            "hostel_id": "hostel-1",
            "upload_ids": [first_upload["upload_id"], second_upload["upload_id"]],
        },
    )

    assert extracted.status_code == 200
    assert extracted.json()["text"] == (
        "1. Monthly rent: Rs. 5,000\n\n2. భోజన సమయం: ఉదయం 8:00"
    )
    assert len(request_bodies) == 2
    assert all(len(body["contents"][0]["parts"]) >= 3 for body in request_bodies)
    assert rules_db.rule_drafts.documents[0]["text"] == extracted.json()["text"]
    assert rules_db.rule_drafts.documents[0]["source_image_ids"] == [
        first_upload["upload_id"],
        second_upload["upload_id"],
    ]
    assert not rules_db.rules_policies.documents


def test_ocr_rejects_truncated_or_empty_model_output_without_saving_draft(rules_db, monkeypatch):
    monkeypatch.setattr(server, "RULES_OCR_API_KEY", "test-key")
    client = client_for(OWNER)
    uploaded = client.post(
        "/api/owner/rules/images?hostel_id=hostel-1",
        files={"file": ("rules.png", png_bytes(), "image/png")},
    ).json()

    class FakeResponse:
        status_code = 200

        def __init__(self, finish_reason, text):
            self.finish_reason = finish_reason
            self.text = text

        def json(self):
            return {
                "candidates": [{
                    "finishReason": self.finish_reason,
                    "content": {"parts": [{"text": self.text}]},
                }],
            }

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            self.response = next(fake_responses)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return self.response

    fake_responses = iter([
        FakeResponse("MAX_TOKENS", '{"text":"1. Rule", "uncertain_sections":[]}'),
        FakeResponse("STOP", '{"text":"", "uncertain_sections":["all text"]}'),
    ])
    monkeypatch.setattr(server.httpx, "AsyncClient", FakeAsyncClient)

    payload = {"hostel_id": "hostel-1", "upload_ids": [uploaded["upload_id"]]}
    truncated = client.post("/api/owner/rules/ocr", json=payload)
    empty = client.post("/api/owner/rules/ocr", json=payload)

    assert truncated.status_code == 422
    assert empty.status_code == 422
    assert not rules_db.rule_drafts.documents
