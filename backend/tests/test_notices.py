import os
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_notice_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


class Collection:
    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])

    async def find_one(self, query, projection=None):
        document = next((
            item for item in self.documents
            if all(item.get(key) == value for key, value in query.items())
        ), None)
        return deepcopy(document)

    async def delete_one(self, query):
        for index, document in enumerate(self.documents):
            if all(document.get(key) == value for key, value in query.items()):
                del self.documents[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


@pytest.fixture
def notice_db(monkeypatch):
    hostels = Collection([
        {"id": "hostel-1", "owner_id": "owner-1"},
        {"id": "hostel-2", "owner_id": "owner-2"},
    ])
    notices = Collection([
        {"id": "notice-1", "hostel_id": "hostel-1", "title": "Owned"},
        {"id": "notice-2", "hostel_id": "hostel-2", "title": "Other owner"},
    ])
    monkeypatch.setattr(server, "db", SimpleNamespace(hostels=hostels, notices=notices))
    yield notices
    server.app.dependency_overrides.clear()


def client_for(role):
    async def current_user():
        return {"id": "owner-1", "role": role}

    server.app.dependency_overrides[server.get_current_user] = current_user
    return TestClient(server.app)


def test_owner_can_delete_notice_from_owned_hostel(notice_db):
    response = client_for("owner").delete("/api/owner/notices/notice-1")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert all(item["id"] != "notice-1" for item in notice_db.documents)
    assert any(item["id"] == "notice-2" for item in notice_db.documents)


def test_owner_cannot_delete_another_owners_notice(notice_db):
    response = client_for("owner").delete("/api/owner/notices/notice-2")

    assert response.status_code == 404
    assert any(item["id"] == "notice-2" for item in notice_db.documents)


def test_non_owner_cannot_delete_notice(notice_db):
    response = client_for("tenant").delete("/api/owner/notices/notice-1")

    assert response.status_code == 403
    assert any(item["id"] == "notice-1" for item in notice_db.documents)


def test_missing_notice_returns_not_found(notice_db):
    response = client_for("owner").delete("/api/owner/notices/missing")

    assert response.status_code == 404
