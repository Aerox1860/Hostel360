import asyncio
import os
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_auth_password_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


class MemoryCollection:
    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])

    async def find_one(self, query, projection=None):
        item = next((doc for doc in self.documents if all(doc.get(k) == v for k, v in query.items())), None)
        return deepcopy(item)

    async def insert_one(self, document):
        self.documents.append(deepcopy(document))

    async def update_one(self, query, update):
        item = next((doc for doc in self.documents if all(doc.get(k) == v for k, v in query.items())), None)
        if item:
            item.update(deepcopy(update.get("$set", {})))
            return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


class MemoryRooms(MemoryCollection):
    async def update_one(self, query, update):
        self.documents[0]["beds"][0].update({"status": "occupied", "tenant_id": "tenant-1"})
        return SimpleNamespace(modified_count=1)


@pytest.fixture
def fake_users(monkeypatch):
    collection = MemoryCollection()
    database = SimpleNamespace(
        users=collection,
        rooms=MemoryRooms([{
            "id": "room-1",
            "hostel_id": "hostel-1",
            "room_number": "101",
            "beds": [{"bed_number": "101-1", "status": "available", "tenant_id": None}],
        }]),
        tenants=MemoryCollection(),
    )
    monkeypatch.setattr(server, "db", database)
    return collection


def tenant_user(password, **fields):
    return {
        "id": "tenant-first-login",
        "email": "first-login@example.com",
        "password_hash": server.hash_pw(password),
        "name": "Tenant",
        "mobile": "9990000000",
        "role": "tenant",
        "auth_provider": "password",
        "blocked": False,
        "active": True,
        **fields,
    }


def test_passwords_are_bcrypt_hashed_and_reject_truncation():
    password_hash = server.hash_pw("correct horse battery staple")
    assert password_hash.startswith("$2b$12$")
    assert password_hash != "correct horse battery staple"
    assert server.verify_pw("correct horse battery staple", password_hash)
    assert not server.verify_pw("incorrect password", password_hash)
    with pytest.raises(ValueError, match="72 UTF-8 bytes"):
        server.hash_pw("x" * 73)
    with pytest.raises(ValidationError):
        server.RegisterBody(
            email="too-long@example.com",
            password="x" * 73,
            name="Long Password",
        )


def test_password_validation_errors_do_not_echo_submitted_password(fake_users):
    submitted_password = "never-echo-this-" + ("x" * 80)
    response = TestClient(server.app).post("/api/auth/register", json={
        "email": "validation@example.com",
        "password": submitted_password,
        "name": "Validation User",
    })
    assert response.status_code == 422
    assert submitted_password not in response.text
    assert "input" not in response.json()["detail"][0]

    fake_users.documents.append(tenant_user(
        server.TENANT_INITIAL_PASSWORD,
        must_change_password=True,
    ))
    token = server.make_token(fake_users.documents[0])
    invalid_current_password = TestClient(server.app).post(
        "/api/auth/password/change",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": 12345, "new_password": "valid-new-password"},
    )
    assert invalid_current_password.status_code == 422
    assert "12345" not in invalid_current_password.text


def test_registration_stores_only_hash_and_returns_safe_public_user(fake_users):
    result = asyncio.run(server.register(server.RegisterBody(
        email="New.User@example.com",
        password="private-password",
        name="New User",
        role="tenant",
    )))

    stored = fake_users.documents[0]
    assert stored["email"] == "new.user@example.com"
    assert stored["password_hash"] != "private-password"
    assert server.verify_pw("private-password", stored["password_hash"])
    assert "password" not in result["user"]
    assert "password_hash" not in result["user"]
    assert "private-password" not in str(result)


def test_login_verifies_password_without_rehashing_legacy_bcrypt_account(fake_users):
    original_hash = server.bcrypt.hashpw(
        b"existing-account-password",
        server.bcrypt.gensalt(rounds=12),
    ).decode()
    fake_users.documents.append({
        "id": "existing-user",
        "email": "existing@example.com",
        "password_hash": original_hash,
        "name": "Existing User",
        "role": "owner",
        "auth_provider": "password",
    })

    result = asyncio.run(server.login(server.LoginBody(
        email="existing@example.com",
        password="existing-account-password",
    )))
    assert result["user"]["role"] == "owner"
    assert "password_hash" not in result["user"]
    assert fake_users.documents[0]["password_hash"] == original_hash

    with pytest.raises(HTTPException) as error:
        asyncio.run(server.login(server.LoginBody(
            email="existing@example.com",
            password="wrong-password",
        )))
    assert error.value.status_code == 401


def test_owner_password_reset_hashes_new_password_and_never_returns_it(fake_users):
    fake_users.documents.append({
        "id": "owner-1",
        "email": "owner@example.com",
        "role": "owner",
        "password_hash": server.hash_pw("original-password"),
    })
    body = server.OwnerActionBody(
        action="reset_password",
        new_password="replacement-password",
    )
    result = asyncio.run(server.owner_action("owner-1", body, {"id": "admin-1", "role": "admin"}))

    new_hash = fake_users.documents[0]["password_hash"]
    assert result == {"ok": True}
    assert server.verify_pw("replacement-password", new_hash)
    assert not server.verify_pw("original-password", new_hash)
    assert "replacement-password" not in str(result)
    with pytest.raises(ValidationError):
        server.OwnerActionBody(action="reset_password")


def test_tenant_login_requires_explicit_password_and_supported_length():
    common = {
        "name": "Tenant",
        "mobile": "9990000000",
        "email": "tenant@example.com",
        "room_id": "room-1",
        "bed_number": "1-1",
        "joining_date": "2026-01-01",
        "monthly_rent": 5000,
        "create_login": True,
    }
    with pytest.raises(ValidationError):
        server.TenantBody(**common)
    with pytest.raises(ValidationError):
        server.TenantBody(**common, password="x" * 73)
    assert server.TenantBody(**common, password="user-selected-password").create_login


def test_tenant_account_creation_stores_hash_and_does_not_return_password(fake_users, monkeypatch):
    async def owner_hostel(_user, _hostel_id):
        return {"id": "hostel-1"}

    monkeypatch.setattr(server, "get_owner_hostel", owner_hostel)
    password = "tenant-private-password"
    result = asyncio.run(server.owner_add_tenant(
        server.TenantBody(
            name="Tenant",
            mobile="9990000000",
            email="new-tenant@example.com",
            room_id="room-1",
            bed_number="101-1",
            joining_date="2026-01-01",
            monthly_rent=5000,
            create_login=True,
            password=password,
        ),
        {"id": "owner-1", "role": "owner"},
    ))

    assert set(result) == {"tenant"}
    assert "password" not in result["tenant"]
    assert password not in str(result)
    saved_user = fake_users.documents[0]
    assert server.verify_pw(password, saved_user["password_hash"])
    assert saved_user.get("must_change_password", False) is False


def test_tenant_account_created_with_initial_password_is_marked_for_change(fake_users, monkeypatch):
    async def owner_hostel(_user, _hostel_id):
        return {"id": "hostel-1"}

    monkeypatch.setattr(server, "get_owner_hostel", owner_hostel)
    asyncio.run(server.owner_add_tenant(
        server.TenantBody(
            name="Tenant",
            mobile="9990000000",
            email="initial-password@example.com",
            room_id="room-1",
            bed_number="101-1",
            joining_date="2026-01-01",
            monthly_rent=5000,
            create_login=True,
            password=server.TENANT_INITIAL_PASSWORD,
        ),
        {"id": "owner-1", "role": "owner"},
    ))
    assert fake_users.documents[0]["must_change_password"] is True


def test_tenant_initial_password_login_requires_change_and_blocks_protected_routes(fake_users):
    fake_users.documents.append(tenant_user(server.TENANT_INITIAL_PASSWORD))
    client = TestClient(server.app)

    login = client.post("/api/auth/login", json={
        "email": "first-login@example.com",
        "password": server.TENANT_INITIAL_PASSWORD,
    })
    assert login.status_code == 200
    assert login.json()["user"]["must_change_password"] is True
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert fake_users.documents[0]["must_change_password"] is True
    assert client.get("/api/auth/me", headers=headers).json()["user"]["must_change_password"] is True

    for path in ("/api/tenant/home", "/api/advertisements/current", "/api/favorites"):
        blocked = client.get(path, headers=headers)
        assert blocked.status_code == 403
        assert blocked.json()["detail"]["code"] == "password_change_required"

    assert client.get("/api/tenant/home").status_code == 401


def test_tenant_password_change_requires_current_password_and_enables_access(fake_users):
    fake_users.documents.append(tenant_user(
        server.TENANT_INITIAL_PASSWORD,
        must_change_password=True,
    ))
    client = TestClient(server.app)
    login = client.post("/api/auth/login", json={
        "email": "first-login@example.com",
        "password": server.TENANT_INITIAL_PASSWORD,
    })
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    failed = client.post("/api/auth/password/change", headers=headers, json={
        "current_password": "incorrect-temporary-password",
        "new_password": "a-new-secure-password",
    })
    assert failed.status_code == 400
    assert fake_users.documents[0]["must_change_password"] is True
    assert client.get("/api/tenant/home", headers=headers).status_code == 403

    changed = client.post("/api/auth/password/change", headers=headers, json={
        "current_password": server.TENANT_INITIAL_PASSWORD,
        "new_password": "a-new-secure-password",
    })
    assert changed.status_code == 200
    assert changed.json()["user"]["must_change_password"] is False
    assert "password_hash" not in changed.json()["user"]
    assert fake_users.documents[0]["must_change_password"] is False
    assert server.verify_pw("a-new-secure-password", fake_users.documents[0]["password_hash"])
    assert client.get("/api/tenant/home", headers=headers).status_code == 200
    assert client.post("/api/auth/password/change", headers=headers, json={
        "current_password": "a-new-secure-password",
        "new_password": "another-secure-password",
    }).status_code == 409


def test_tenant_logout_and_relogin_preserve_completed_password_change(fake_users):
    fake_users.documents.append(tenant_user(
        server.TENANT_INITIAL_PASSWORD,
        must_change_password=True,
    ))
    client = TestClient(server.app)
    initial_login = client.post("/api/auth/login", json={
        "email": "first-login@example.com",
        "password": server.TENANT_INITIAL_PASSWORD,
    })
    initial_headers = {"Authorization": f"Bearer {initial_login.json()['access_token']}"}
    changed = client.post("/api/auth/password/change", headers=initial_headers, json={
        "current_password": server.TENANT_INITIAL_PASSWORD,
        "new_password": "new-password-after-login",
    })
    assert changed.status_code == 200

    # Logout is client-side token removal; without the token, protected APIs reject the request.
    assert client.get("/api/tenant/home").status_code == 401
    assert client.post("/api/auth/login", json={
        "email": "first-login@example.com",
        "password": server.TENANT_INITIAL_PASSWORD,
    }).status_code == 401
    next_login = client.post("/api/auth/login", json={
        "email": "first-login@example.com",
        "password": "new-password-after-login",
    })
    assert next_login.status_code == 200
    assert next_login.json()["user"]["must_change_password"] is False


def test_existing_tenant_with_different_password_is_not_force_migrated(fake_users):
    fake_users.documents.append(tenant_user("tenant-chosen-password"))
    client = TestClient(server.app)
    response = client.post("/api/auth/login", json={
        "email": "first-login@example.com",
        "password": "tenant-chosen-password",
    })
    assert response.status_code == 200
    assert response.json()["user"]["must_change_password"] is False
    assert "must_change_password" not in fake_users.documents[0]
