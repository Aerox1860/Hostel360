import os
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_property_browsing_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


class Cursor:
    def __init__(self, documents):
        self.documents = documents

    def sort(self, key, direction=1):
        self.documents.sort(key=lambda item: item.get(key, ""), reverse=direction < 0)
        return self

    async def to_list(self, length):
        return deepcopy(self.documents if length is None else self.documents[:length])


class Collection:
    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])

    def find(self, query=None, projection=None):
        query = query or {}
        documents = [
            item for item in self.documents
            if all(item.get(key) == value for key, value in query.items() if not key.startswith("$"))
        ]
        return Cursor(documents)

    async def find_one(self, query=None, projection=None):
        query = query or {}
        item = next((
            doc for doc in self.documents
            if all(doc.get(key) == value for key, value in query.items())
        ), None)
        return deepcopy(item)


@pytest.fixture
def property_db(monkeypatch):
    hostels = Collection([{
        "id": "property-1",
        "status": "approved",
        "name": "Public Stay",
        "city": "Bengaluru",
        "area": "Central",
        "gender": "co-living",
        "property_type": "co_living_pg",
        "photos": ["https://example.com/public.jpg"],
        "min_rent": 5000,
        "rating": 4.8,
        "verification_status": "verified",
        "address": "Private full address",
        "mobile": "9990001111",
        "owner_mobile": "9990002222",
        "amenities": ["Wi-Fi", "Food"],
        "ownership_proof": "private-document",
        "sharing_types": ["single", "double"],
    }])
    monkeypatch.setattr(server, "db", SimpleNamespace(
        hostels=hostels,
        reviews=Collection(),
        rooms=Collection(),
    ))
    yield hostels
    server.app.dependency_overrides.clear()


def test_public_property_listing_returns_only_card_fields(property_db):
    response = TestClient(server.app).get("/api/public/hostels")

    assert response.status_code == 200
    card = response.json()["hostels"][0]
    assert card["id"] == "property-1"
    assert card["photos"] == ["https://example.com/public.jpg"]
    assert card["min_rent"] == 5000
    assert card["property_type"] == "co_living_pg"
    assert not {"address", "mobile", "owner_mobile", "amenities", "ownership_proof"} & card.keys()


def test_property_details_require_authentication_and_are_available_after_login(property_db):
    client = TestClient(server.app)
    response = client.get("/api/public/hostels/property-1")

    assert response.status_code == 401
    assert "Private full address" not in response.text
    assert "9990001111" not in response.text
    assert "Wi-Fi" not in response.text

    async def authenticated_tenant():
        return {"id": "tenant-1", "role": "tenant"}

    server.app.dependency_overrides[server.get_current_user] = authenticated_tenant
    authenticated = client.get("/api/public/hostels/property-1")
    assert authenticated.status_code == 200
    detail = authenticated.json()["hostel"]
    assert detail["address"] == "Private full address"
    assert detail["mobile"] == "9990001111"
    assert detail["amenities"] == ["Wi-Fi", "Food"]
    assert detail["property_type"] == "co_living_pg"


def test_property_type_is_required_and_limited_to_supported_values():
    base = {
        "name": "Test Stay",
        "owner_name": "Owner",
        "mobile": "9990001111",
        "address": "Street",
        "city": "Bengaluru",
        "state": "Karnataka",
    }
    allowed = {
        "boys_pg_hostel",
        "girls_pg_hostel",
        "co_living_pg",
        "co_living_hostel",
    }

    for value in allowed:
        body = server.HostelBody(**base, property_type=value)
        assert body.property_type == value

    with pytest.raises(ValidationError):
        server.HostelBody(**base)

    with pytest.raises(ValidationError):
        server.HostelBody(**base, property_type="other")
