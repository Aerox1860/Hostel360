import asyncio
import os
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_google_auth_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


class MemoryUsers:
    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])

    async def find_one(self, query, projection=None):
        return deepcopy(next(
            (document for document in self.documents
             if all(document.get(key) == value for key, value in query.items())),
            None,
        ))

    async def insert_one(self, document):
        if any(
            existing.get("email") == document.get("email")
            or (
                document.get("google_sub")
                and existing.get("google_sub") == document["google_sub"]
            )
            for existing in self.documents
        ):
            raise DuplicateKeyError("duplicate user key")
        self.documents.append(deepcopy(document))

    async def update_one(self, query, update):
        document = next(
            (item for item in self.documents
             if all(item.get(key) == value for key, value in query.items())),
            None,
        )
        if document is None:
            return SimpleNamespace(matched_count=0)
        document.update(deepcopy(update.get("$set", {})))
        return SimpleNamespace(matched_count=1)


@pytest.fixture
def google_users(monkeypatch):
    users = MemoryUsers()
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))
    monkeypatch.setattr(server, "GOOGLE_OAUTH_CLIENT_IDS", ("hostel360-web-client",))
    return users


def google_claims(**overrides):
    return {
        "sub": "google-subject-123",
        "email": "google.user@example.com",
        "email_verified": True,
        "iss": "https://accounts.google.com",
        "aud": "hostel360-web-client",
        "name": "Google User",
        "picture": "https://example.com/profile.png",
        **overrides,
    }


def test_google_token_verifier_requires_configured_audience(monkeypatch):
    monkeypatch.setattr(server, "GOOGLE_OAUTH_CLIENT_IDS", ("allowed-client",))
    monkeypatch.setattr(
        server.google_id_token,
        "verify_oauth2_token",
        lambda token, request, audience: google_claims(aud="untrusted-client"),
    )
    with pytest.raises(HTTPException) as error:
        server.verify_google_identity("signed-token")
    assert error.value.status_code == 401


def test_google_token_verifier_requires_verified_email(monkeypatch):
    monkeypatch.setattr(server, "GOOGLE_OAUTH_CLIENT_IDS", ("hostel360-web-client",))
    monkeypatch.setattr(
        server.google_id_token,
        "verify_oauth2_token",
        lambda token, request, audience: google_claims(email_verified=False),
    )
    with pytest.raises(HTTPException) as error:
        server.verify_google_identity("signed-token")
    assert error.value.status_code == 401


def test_google_token_verifier_rejects_invalid_signature_without_exposing_token(monkeypatch):
    monkeypatch.setattr(server, "GOOGLE_OAUTH_CLIENT_IDS", ("hostel360-web-client",))

    def reject_signature(_token, _request, audience):
        assert audience is None
        raise ValueError("invalid signature")

    monkeypatch.setattr(server.google_id_token, "verify_oauth2_token", reject_signature)
    with pytest.raises(HTTPException) as error:
        server.verify_google_identity("sensitive-token")
    assert error.value.status_code == 401
    assert "sensitive-token" not in error.value.detail


def test_google_signin_is_disabled_until_backend_client_ids_are_configured(monkeypatch):
    monkeypatch.setattr(server, "GOOGLE_OAUTH_CLIENT_IDS", ())
    with pytest.raises(HTTPException) as error:
        server.verify_google_identity("signed-token")
    assert error.value.status_code == 503


def test_google_subject_index_matches_existing_sparse_unique_index(monkeypatch):
    class IndexCollection:
        def __init__(self):
            self.calls = []

        async def create_index(self, keys, **options):
            self.calls.append((keys, options))

    users = IndexCollection()
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))

    asyncio.run(server._ensure_google_subject_index())

    assert users.calls == [(
        "google_sub",
        {"unique": True, "sparse": True, "name": "user_google_sub"},
    )]


def test_google_login_creates_tenant_from_verified_claims_and_ignores_client_role(
    google_users, monkeypatch
):
    monkeypatch.setattr(server, "verify_google_identity", lambda token: google_claims())
    response = TestClient(server.app).post("/api/auth/google", json={
        "id_token": "signed-token",
        "role": "admin",
    })

    assert response.status_code == 200
    result = response.json()
    assert result["user"]["role"] == "tenant"
    assert result["user"]["email"] == "google.user@example.com"
    assert "google_sub" not in result["user"]
    assert google_users.documents[0]["google_sub"] == "google-subject-123"
    assert "password_hash" not in result["user"]


def test_invalid_google_token_is_rejected_without_creating_account(google_users, monkeypatch):
    def reject(_token):
        raise HTTPException(401, "Invalid Google ID token")

    monkeypatch.setattr(server, "verify_google_identity", reject)
    response = TestClient(server.app).post("/api/auth/google", json={"id_token": "invalid"})
    assert response.status_code == 401
    assert google_users.documents == []


def test_oversized_token_validation_does_not_echo_the_token(google_users):
    token = "sensitive-token-" + ("x" * 8192)
    response = TestClient(server.app).post("/api/auth/google", json={"id_token": token})
    assert response.status_code == 422
    assert token not in response.text


def test_password_account_requires_authenticated_explicit_google_link(
    google_users, monkeypatch
):
    password_hash = server.hash_pw("owner-password")
    google_users.documents.append({
        "id": "owner-account",
        "email": "google.user@example.com",
        "password_hash": password_hash,
        "role": "owner",
        "auth_provider": "password",
        "name": "Existing Owner",
        "blocked": False,
    })
    monkeypatch.setattr(server, "verify_google_identity", lambda token: google_claims())
    client = TestClient(server.app)

    rejected = client.post("/api/auth/google", json={"id_token": "signed-token"})
    assert rejected.status_code == 409
    assert rejected.json()["detail"]["code"] == "google_link_required"
    assert "google_sub" not in google_users.documents[0]

    linked = client.post(
        "/api/auth/google/link",
        headers={"Authorization": f"Bearer {server.make_token(google_users.documents[0])}"},
        json={"id_token": "signed-token"},
    )
    assert linked.status_code == 200
    assert linked.json()["user"]["role"] == "owner"
    assert google_users.documents[0]["auth_provider"] == "password"
    assert google_users.documents[0]["password_hash"] == password_hash
    assert google_users.documents[0]["google_sub"] == "google-subject-123"

    google_login = client.post("/api/auth/google", json={"id_token": "signed-token"})
    assert google_login.status_code == 200
    assert google_login.json()["user"]["role"] == "owner"


def test_google_email_mismatch_cannot_link_an_authenticated_account(google_users, monkeypatch):
    google_users.documents.append({
        "id": "owner-account",
        "email": "owner@example.com",
        "password_hash": server.hash_pw("owner-password"),
        "role": "owner",
        "auth_provider": "password",
    })
    monkeypatch.setattr(server, "verify_google_identity", lambda token: google_claims())
    response = TestClient(server.app).post(
        "/api/auth/google/link",
        headers={"Authorization": f"Bearer {server.make_token(google_users.documents[0])}"},
        json={"id_token": "signed-token"},
    )
    assert response.status_code == 403
    assert "google_sub" not in google_users.documents[0]


def test_google_identity_conflict_does_not_treat_another_subject_as_linkable(
    google_users, monkeypatch
):
    google_users.documents.append({
        "id": "existing-google-user",
        "email": "google.user@example.com",
        "role": "tenant",
        "auth_provider": "google",
        "google_sub": "different-google-subject",
    })
    monkeypatch.setattr(server, "verify_google_identity", lambda token: google_claims())
    response = TestClient(server.app).post("/api/auth/google", json={"id_token": "signed-token"})

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "google_identity_conflict"
    assert google_users.documents[0]["google_sub"] == "different-google-subject"


def test_existing_google_admin_role_is_preserved_and_logout_needs_no_server_token(
    google_users, monkeypatch
):
    google_users.documents.append({
        "id": "admin-account",
        "email": "google.user@example.com",
        "role": "admin",
        "auth_provider": "google",
        "blocked": False,
    })
    monkeypatch.setattr(server, "verify_google_identity", lambda token: google_claims())
    client = TestClient(server.app)
    login = client.post("/api/auth/google", json={"id_token": "signed-token"})
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "admin"
    assert client.get("/api/auth/me").status_code == 401
    assert client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    ).status_code == 200
