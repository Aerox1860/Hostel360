import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import ServerSelectionTimeoutError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_deployment_health_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


def configure_production(monkeypatch):
    monkeypatch.setattr(server, "APP_ENV", "production")
    monkeypatch.setattr(server, "JWT_SECRET", "a" * 64)
    monkeypatch.setattr(server, "ADMIN_PASSWORD", "strong-password-123")
    monkeypatch.setattr(server, "TENANT_DOCUMENT_ENCRYPTION_KEY", server.Fernet.generate_key().decode("ascii"))
    monkeypatch.setattr(server, "TENANT_AADHAAR_HMAC_KEY", "b" * 32)
    monkeypatch.setattr(server, "CORS_ALLOWED_ORIGINS", ["https://app.example.com"])


def test_health_endpoint_does_not_require_database():
    response = TestClient(server.app).get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_endpoint_reports_mongodb_availability(monkeypatch):
    async def ping(command):
        assert command == "ping"
        return {"ok": 1}

    monkeypatch.setattr(server, "db", SimpleNamespace(command=ping))

    response = TestClient(server.app).get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readiness_endpoint_returns_503_without_leaking_database_errors(monkeypatch):
    async def ping(command):
        raise ServerSelectionTimeoutError("private connection detail")

    monkeypatch.setattr(server, "db", SimpleNamespace(command=ping))

    response = TestClient(server.app).get("/readyz")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}
    assert "private connection detail" not in response.text


def test_production_config_rejects_default_authentication_secrets(monkeypatch):
    configure_production(monkeypatch)
    monkeypatch.setattr(server, "JWT_SECRET", "hostel360-dev-secret")

    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        server._validate_production_config()


def test_production_config_rejects_wildcard_cors(monkeypatch):
    configure_production(monkeypatch)
    monkeypatch.setattr(server, "CORS_ALLOWED_ORIGINS", ["*"])

    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
        server._validate_production_config()


def test_production_config_accepts_explicit_secure_settings(monkeypatch):
    configure_production(monkeypatch)

    server._validate_production_config()


def test_production_config_requires_data_protection_keys(monkeypatch):
    configure_production(monkeypatch)
    monkeypatch.setattr(server, "TENANT_DOCUMENT_ENCRYPTION_KEY", "")

    with pytest.raises(RuntimeError, match="TENANT_DOCUMENT_ENCRYPTION_KEY"):
        server._validate_production_config()


def test_production_startup_rejects_an_existing_default_admin_password(monkeypatch):
    monkeypatch.setattr(server, "APP_ENV", "production")
    monkeypatch.setattr(server, "verify_pw", lambda password, hashed: password == "Admin@12345")

    with pytest.raises(RuntimeError, match="default admin password"):
        server._validate_existing_admin({"password_hash": "hashed-default"})
