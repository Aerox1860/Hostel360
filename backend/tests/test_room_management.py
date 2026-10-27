import asyncio
import os
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_room_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


OWNER = {"id": "owner-1", "role": "owner"}
HOSTELS = [
    {"id": "hostel-1", "owner_id": "owner-1", "name": "Test Hostel", "trial_ends_at": "2099-01-01T00:00:00+00:00"},
    {"id": "hostel-2", "owner_id": "owner-1", "name": "Other Hostel", "trial_ends_at": "2099-01-01T00:00:00+00:00"},
]


class Cursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, length):
        return deepcopy(self.documents if length is None else self.documents[:length])

    def __aiter__(self):
        self._iterator = iter(deepcopy(self.documents))
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration:
            raise StopAsyncIteration


def matches(document, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(matches(document, clause) for clause in expected):
                return False
            continue
        actual = document
        for part in key.split("."):
            if isinstance(actual, list):
                actual = [item.get(part) for item in actual if isinstance(item, dict)]
            elif isinstance(actual, dict):
                actual = actual.get(part)
            else:
                actual = None
        if isinstance(expected, dict):
            if "$elemMatch" in expected:
                if not isinstance(actual, list) or not any(
                    matches(item, expected["$elemMatch"]) for item in actual
                ):
                    return False
            elif "$exists" in expected:
                if (key in document) != expected["$exists"]:
                    return False
            elif "$in" in expected:
                if actual not in expected["$in"]:
                    return False
            elif "$ne" in expected:
                if actual == expected["$ne"]:
                    return False
            else:
                return False
        elif actual != expected and not (isinstance(actual, list) and expected in actual):
            return False
    return True


class FakeCollection:
    def __init__(self, documents=None, unique_room_key=False):
        self.documents = deepcopy(documents or [])
        self.unique_room_key = unique_room_key

    def find(self, query=None, projection=None):
        query = query or {}
        return Cursor([doc for doc in self.documents if matches(doc, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        document = next((doc for doc in self.documents if matches(doc, query)), None)
        return deepcopy(document)

    async def insert_one(self, document):
        await asyncio.sleep(0)
        if self.unique_room_key and any(
            all(current.get(key) == document.get(key) for key in ("hostel_id", "floor_key", "room_key"))
            for current in self.documents
        ):
            raise DuplicateKeyError("Duplicate normalized room key")
        self.documents.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def delete_one(self, query):
        for index, document in enumerate(self.documents):
            if matches(document, query):
                del self.documents[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def update_one(self, query, update, upsert=False):
        document = next((doc for doc in self.documents if matches(doc, query)), None)
        if document is None:
            if not upsert:
                return SimpleNamespace(matched_count=0, modified_count=0)
            document = deepcopy(query)
            document.update(deepcopy(update.get("$setOnInsert", {})))
            self.documents.append(document)
            return SimpleNamespace(matched_count=0, modified_count=1)

        positional_items = {}
        for key, value in update.get("$set", {}).items():
            if ".$." in key:
                prefix, field = key.split(".$.", 1)
                if prefix not in positional_items:
                    conditions = query.get(prefix, {}).get("$elemMatch", {})
                    conditions = {
                        **conditions,
                        **{
                            query_key[len(prefix) + 1:]: query_value
                            for query_key, query_value in query.items()
                            if query_key.startswith(prefix + ".")
                        },
                    }
                    positional_items[prefix] = next(
                        (entry for entry in document[prefix] if matches(entry, conditions)), None
                    )
                item = positional_items[prefix]
                if item is not None:
                    item[field] = deepcopy(value)
            else:
                document[key] = deepcopy(value)
        return SimpleNamespace(matched_count=1, modified_count=1)

    async def create_index(self, *args, **kwargs):
        return "test_index"


@pytest.fixture
def fake_db(monkeypatch):
    db = SimpleNamespace(
        rooms=FakeCollection(),
        room_keys=FakeCollection(unique_room_key=True),
        tenants=FakeCollection(),
        hostels=FakeCollection(HOSTELS),
        payments=FakeCollection(),
        expenses=FakeCollection(),
    )
    monkeypatch.setattr(server, "db", db)
    return db


def add_room(floor="1", room_number="101", hostel_id="hostel-1", bed_count=2):
    return asyncio.run(server.owner_add_room(
        server.RoomBody(
            hostel_id=hostel_id,
            floor=floor,
            room_number=room_number,
            rent=7000,
            bed_count=bed_count,
        ),
        OWNER,
    ))


@pytest.mark.parametrize("bed_count", [1, 2, 7])
def test_room_creation_accepts_bed_count_boundaries(fake_db, monkeypatch, bed_count):
    monkeypatch.setattr(server, "_refresh_hostel_meta", _async_noop)
    room = add_room(room_number=f"R{bed_count}", bed_count=bed_count)["room"]
    assert len(room["beds"]) == bed_count
    assert room["bed_count"] == bed_count
    assert "room_type" not in room
    assert len(fake_db.rooms.documents) == 1


@pytest.mark.parametrize("bed_count", [0, -1, 8, 100, "invalid", 2.5])
def test_room_body_rejects_invalid_bed_counts(bed_count):
    with pytest.raises(ValidationError):
        server.RoomBody(floor="1", room_number="101", rent=7000, bed_count=bed_count)


def test_room_body_requires_bed_count():
    with pytest.raises(ValidationError):
        server.RoomBody(floor="1", room_number="101", rent=7000)


def test_duplicate_room_rejected_after_case_and_whitespace_normalization(fake_db, monkeypatch):
    monkeypatch.setattr(server, "_refresh_hostel_meta", _async_noop)
    add_room(floor=" First ", room_number=" A101 ")
    with pytest.raises(HTTPException) as error:
        add_room(floor="first", room_number="a101")
    assert error.value.status_code == 409
    assert "already exists" in error.value.detail
    assert len(fake_db.rooms.documents) == 1


def test_room_number_can_repeat_on_other_floor_or_hostel(fake_db, monkeypatch):
    monkeypatch.setattr(server, "_refresh_hostel_meta", _async_noop)
    add_room(floor="1", room_number="101")
    add_room(floor="2", room_number="101")
    add_room(floor="1", room_number="101", hostel_id="hostel-2")
    assert len(fake_db.rooms.documents) == 3


def test_concurrent_duplicate_room_creation_is_serialized(fake_db, monkeypatch):
    monkeypatch.setattr(server, "_refresh_hostel_meta", _async_noop)

    async def create_both():
        body = server.RoomBody(floor="1", room_number="101", rent=7000, bed_count=1)
        return await asyncio.gather(
            server.owner_add_room(body, OWNER),
            server.owner_add_room(body, OWNER),
            return_exceptions=True,
        )

    results = asyncio.run(create_both())
    assert sum(not isinstance(result, Exception) for result in results) == 1
    errors = [result for result in results if isinstance(result, HTTPException)]
    assert len(errors) == 1 and errors[0].status_code == 409
    assert len(fake_db.rooms.documents) == 1


def test_migration_reports_legacy_duplicates_without_deleting_data(fake_db, caplog):
    fake_db.rooms.documents.extend([
        {
            "id": "legacy-1", "hostel_id": "hostel-1", "floor": " First ",
            "room_number": " A101 ", "room_type": "single", "bed_count": 7,
            "beds": [{"bed_number": "A101-1", "status": "occupied", "tenant_id": "tenant-1"}],
        },
        {
            "id": "legacy-2", "hostel_id": "hostel-1", "floor": "first",
            "room_number": "a101", "room_type": "double", "bed_count": 0,
            "beds": [{"bed_number": "a101-1", "status": "available"}],
        },
    ])
    fake_db.tenants.documents.append({"id": "tenant-1", "room_id": "legacy-1", "active": True})

    asyncio.run(server._ensure_room_key_index())

    assert len(fake_db.rooms.documents) == 2
    assert [r["bed_count"] for r in fake_db.rooms.documents] == [1, 1]
    assert fake_db.rooms.documents[0]["beds"][0]["tenant_id"] == "tenant-1"
    assert fake_db.rooms.documents[0]["room_type"] == "single"
    assert fake_db.tenants.documents == [{"id": "tenant-1", "room_id": "legacy-1", "active": True}]
    assert len(fake_db.room_keys.documents) == 1
    assert "Duplicate room migration conflict" in caplog.text
    assert "renumbering/moving a room" in caplog.text


def test_existing_room_list_uses_bed_records_and_keeps_tenant_allocation(fake_db, monkeypatch):
    room = {
        "id": "legacy-room",
        "hostel_id": "hostel-1",
        "floor": "1",
        "room_number": "101",
        "room_type": "double",
        "beds": [
            {"bed_number": "101-1", "status": "occupied", "tenant_id": "tenant-1"},
            {"bed_number": "101-2", "status": "available", "tenant_id": None},
        ],
    }
    fake_db.rooms.documents.append(room)
    monkeypatch.setattr(server, "get_owner_hostel", _owner_hostel)

    result = asyncio.run(server.owner_rooms("hostel-1", OWNER))["rooms"][0]

    assert result["bed_count"] == 2
    assert "room_type" not in result
    assert result["beds"][0]["tenant_id"] == "tenant-1"
    assert fake_db.rooms.documents[0] == room


def test_dashboard_and_subscription_counts_use_persisted_beds(fake_db, monkeypatch):
    monkeypatch.setattr(server, "get_owner_hostel", _owner_hostel)
    monkeypatch.setattr(server, "now_utc", lambda: server._parse_dt("2026-01-01T00:00:00+00:00"))
    add_room(room_number="101", bed_count=1)
    second = add_room(room_number="102", bed_count=7)["room"]
    second["beds"][0]["status"] = "occupied"
    second["beds"][0]["tenant_id"] = "tenant-1"
    fake_db.rooms.documents[1] = second

    data = asyncio.run(server.owner_dashboard("hostel-1", OWNER))
    assert data["total_rooms"] == 2
    assert data["total_beds"] == 8
    assert data["occupied_beds"] == 1
    assert data["available_beds"] == 7
    assert asyncio.run(server.bed_count_for_hostel("hostel-1")) == 8


def test_available_counts_only_beds_marked_available():
    counts = server._room_bed_counts([
        {"beds": [{"status": "occupied"}, {"status": "available"}, {"status": "maintenance"}]}
    ])
    assert counts == {"total": 3, "occupied": 1, "available": 1}


def test_delete_empty_room_removes_room_and_beds_from_counts(fake_db, monkeypatch):
    monkeypatch.setattr(server, "_refresh_hostel_meta", _async_noop)
    monkeypatch.setattr(server, "get_owner_hostel", _owner_hostel)
    room = add_room(room_number="101", bed_count=3)["room"]
    result = asyncio.run(server.owner_delete_room(room["id"], OWNER))
    assert result == {"ok": True}
    assert fake_db.rooms.documents == []
    assert asyncio.run(server.bed_count_for_hostel("hostel-1")) == 0
    dashboard = asyncio.run(server.owner_dashboard("hostel-1", OWNER))
    assert dashboard["total_rooms"] == 0
    assert dashboard["total_beds"] == 0
    assert dashboard["occupied_beds"] == 0
    assert dashboard["available_beds"] == 0


@pytest.mark.parametrize("bed_status,active_tenant", [
    ("occupied", False),
    ("available", True),
])
def test_delete_rejected_for_occupied_bed_or_active_tenant(fake_db, bed_status, active_tenant):
    room = {
        "id": "room-1",
        "hostel_id": "hostel-1",
        "floor": "1",
        "room_number": "101",
        "beds": [{"bed_number": "101-1", "status": bed_status, "tenant_id": None}],
    }
    fake_db.rooms.documents.append(room)
    if active_tenant:
        fake_db.tenants.documents.append({"id": "tenant-1", "room_id": "room-1", "active": True})
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_delete_room("room-1", OWNER))
    assert error.value.status_code == 400
    assert fake_db.rooms.documents == [room]


def test_owner_cannot_delete_another_hostels_room(fake_db):
    fake_db.rooms.documents.append({
        "id": "room-2", "hostel_id": "hostel-2", "floor": "1", "room_number": "101",
        "beds": [{"bed_number": "101-1", "status": "available", "tenant_id": None}],
    })
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.owner_delete_room("room-2", {"id": "different-owner"}))
    assert error.value.status_code == 404
    assert len(fake_db.rooms.documents) == 1


def test_tenant_transfer_and_checkout_preserve_bed_allocations(fake_db, monkeypatch):
    monkeypatch.setattr(server, "_refresh_hostel_meta", _async_noop)
    first = add_room(room_number="101", bed_count=1)["room"]
    second = add_room(room_number="102", bed_count=1)["room"]
    tenant = asyncio.run(server.owner_add_tenant(
        server.TenantBody(
            name="Test Tenant",
            mobile="9990000000",
            room_id=first["id"],
            bed_number=first["beds"][0]["bed_number"],
            joining_date="2026-01-01",
            monthly_rent=7000,
        ),
        OWNER,
    ))["tenant"]
    transferred = asyncio.run(server.owner_transfer_tenant(
        tenant["id"],
        server.TransferBody(room_id=second["id"], bed_number=second["beds"][0]["bed_number"]),
        OWNER,
    ))["tenant"]
    assert transferred["room_id"] == second["id"]
    assert fake_db.rooms.documents[0]["beds"][0]["status"] == "available"
    assert fake_db.rooms.documents[1]["beds"][0]["tenant_id"] == tenant["id"]

    result = asyncio.run(server.owner_checkout_tenant(tenant["id"], OWNER))
    assert result == {"ok": True, "already_checked_out": False}
    assert fake_db.tenants.documents[0]["active"] is False
    assert fake_db.rooms.documents[1]["beds"][0]["status"] == "available"
    assert fake_db.rooms.documents[1]["beds"][0]["tenant_id"] is None


def test_subscription_price_slabs_are_unchanged():
    assert server.PRICE_SLABS == [
        (40, "Up to 40 beds", {1: 299, 3: 799, 6: 1499, 12: 2499}),
        (70, "41 – 70 beds", {1: 499, 3: 1299, 6: 2499, 12: 4499}),
        (100, "71 – 100 beds", {1: 699, 3: 1899, 6: 3699, 12: 6999}),
        (130, "101 – 130 beds", {1: 999, 3: 2699, 6: 5199, 12: 9999}),
        (None, "131+ beds", {1: 1499, 3: 3999, 6: 7999, 12: 14999}),
    ]


async def _async_noop(*args, **kwargs):
    return None


async def _owner_hostel(user, hostel_id=None):
    hostel_id = hostel_id or "hostel-1"
    return next((hostel for hostel in HOSTELS if hostel["id"] == hostel_id), None)
