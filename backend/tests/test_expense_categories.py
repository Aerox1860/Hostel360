import asyncio
import os
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_expense_category_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


class Cursor:
    def __init__(self, documents):
        self.documents = deepcopy(documents)

    def sort(self, key, direction=1):
        self.documents.sort(key=lambda item: item.get(key, ""), reverse=direction < 0)
        return self

    async def to_list(self, length):
        return deepcopy(self.documents if length is None else self.documents[:length])


class Collection:
    def __init__(self, documents=None, unique_category=False):
        self.documents = deepcopy(documents or [])
        self.unique_category = unique_category

    def find(self, query=None, projection=None):
        query = query or {}
        return Cursor([
            document for document in self.documents
            if all(
                document.get(key) in value["$in"] if isinstance(value, dict) and "$in" in value
                else document.get(key) == value
                for key, value in query.items()
            )
        ])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        document = next((
            item for item in self.documents
            if all(
                item.get(key) in value["$in"] if isinstance(value, dict) and "$in" in value
                else item.get(key) == value
                for key, value in query.items()
            )
        ), None)
        return deepcopy(document)

    async def insert_one(self, document):
        if self.unique_category and any(
            all(existing.get(key) == document.get(key)
                for key in ("owner_id", "hostel_id", "normalized_name"))
            for existing in self.documents
        ):
            raise DuplicateKeyError("duplicate category")
        self.documents.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


@pytest.fixture
def expense_db(monkeypatch):
    db = SimpleNamespace(
        hostels=Collection([
            {"id": "hostel-1", "owner_id": "owner-1", "name": "Hostel One"},
            {"id": "hostel-2", "owner_id": "owner-1", "name": "Hostel Two"},
            {"id": "hostel-3", "owner_id": "owner-2", "name": "Hostel Three"},
        ]),
        expense_categories=Collection(unique_category=True),
        expenses=Collection(),
        payments=Collection(),
        rooms=Collection(),
        tenants=Collection(),
    )
    monkeypatch.setattr(server, "db", db)

    async def owner_user():
        return {"id": "owner-1", "role": "owner"}

    server.app.dependency_overrides[server.get_current_user] = owner_user
    yield db
    server.app.dependency_overrides.clear()


def test_custom_category_is_trimmed_persisted_and_property_scoped(expense_db):
    client = TestClient(server.app)
    created = client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1",
        "name": "  Insurance  ",
        "description": "  Annual policy  ",
        "purpose": "property",
    })
    assert created.status_code == 200
    assert created.json()["category"]["name"] == "Insurance"
    assert created.json()["category"]["description"] == "Annual policy"
    assert created.json()["category"]["purpose"] == "property"

    for hostel_id, expected_count in (("hostel-1", 1), ("hostel-2", 0)):
        response = client.get(f"/api/owner/expense-categories?hostel_id={hostel_id}")
        assert response.status_code == 200
        assert len(response.json()["categories"]) == expected_count


def test_category_name_is_required_and_duplicate_names_are_case_insensitive(expense_db):
    client = TestClient(server.app)
    assert client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "   ",
    }).status_code == 422
    assert client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": " Insurance ", "purpose": "property",
    }).status_code == 200
    duplicate = client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "INSURANCE", "purpose": "property",
    })
    assert duplicate.status_code == 409
    assert client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "Missing purpose",
    }).status_code == 422
    assert client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "Invalid purpose", "purpose": "other",
    }).status_code == 422


def test_category_name_can_be_reused_for_other_property_or_owner(expense_db):
    client = TestClient(server.app)
    first = client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "Landscaping", "purpose": "property",
    })
    second_property = client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-2", "name": "Landscaping", "purpose": "personal",
    })
    other_owner = asyncio.run(server.owner_add_expense_category(
        server.ExpenseCategoryBody(hostel_id="hostel-3", name="Landscaping", purpose="property"),
        {"id": "owner-2", "role": "owner"},
    ))

    assert first.status_code == second_property.status_code == 200
    assert other_owner["category"]["owner_id"] == "owner-2"


def test_custom_categories_are_validated_and_saved_with_expenses(expense_db):
    client = TestClient(server.app)
    assert client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "Insurance", "purpose": "property",
    }).status_code == 200

    added = client.post("/api/owner/expenses", json={
        "hostel_id": "hostel-1", "category": " insurance ", "amount": 1200,
        "note": "Policy",
    })
    assert added.status_code == 200
    expense = added.json()["expense"]
    assert expense["category"] == "Insurance"
    assert expense["purpose"] == "property"
    assert expense["note"] == "Policy"

    report = client.get("/api/owner/reports?hostel_id=hostel-1").json()
    assert report["expense_by_category"]["Insurance"] == 1200


def test_expense_category_cannot_be_used_on_another_property(expense_db):
    client = TestClient(server.app)
    client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "Landscaping", "purpose": "property",
    })

    response = client.post("/api/owner/expenses", json={
        "hostel_id": "hostel-2", "category": "Landscaping", "amount": 500,
    })
    assert response.status_code == 400


def test_non_owner_cannot_list_or_create_expense_categories(expense_db):
    async def tenant_user():
        return {"id": "tenant-1", "role": "tenant"}

    server.app.dependency_overrides[server.get_current_user] = tenant_user
    client = TestClient(server.app)

    assert client.get("/api/owner/expense-categories?hostel_id=hostel-1").status_code == 403
    assert client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "Insurance", "purpose": "property",
    }).status_code == 403


def test_owner_cannot_create_category_for_another_owners_property(expense_db):
    response = TestClient(server.app).post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-3", "name": "Insurance", "purpose": "property",
    })
    assert response.status_code == 400
    assert expense_db.expense_categories.documents == []


def test_existing_default_expense_categories_remain_usable(expense_db):
    client = TestClient(server.app)
    response = client.post("/api/owner/expenses", json={
        "hostel_id": "hostel-1", "category": "electricity", "amount": 500,
    })
    assert response.status_code == 200
    assert response.json()["expense"]["category"] == "electricity"
    assert response.json()["expense"]["purpose"] == "property"


def test_property_and_personal_expenses_are_reported_separately(expense_db):
    client = TestClient(server.app)
    client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "Travels", "purpose": "property",
    })
    client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "Medical", "purpose": "personal",
    })
    property_expense = client.post("/api/owner/expenses", json={
        "hostel_id": "hostel-1", "category": "Travels", "amount": 1200,
    })
    personal_expense = client.post("/api/owner/expenses", json={
        "hostel_id": "hostel-1", "category": "Medical", "amount": 300,
    })
    assert property_expense.json()["expense"]["purpose"] == "property"
    assert personal_expense.json()["expense"]["purpose"] == "personal"

    expense_db.payments.documents.append({
        "id": "payment-1", "hostel_id": "hostel-1", "status": "paid", "amount": 5000,
        "date": server.now_utc().isoformat(),
    })
    report = client.get("/api/owner/reports?hostel_id=hostel-1").json()
    assert report["total_expenses"] == 1200
    assert report["personal_expenses"] == 300
    assert report["net_profit"] == 3800
    assert report["expense_by_category"] == {"Travels": 1200}
    assert report["personal_expense_by_category"] == {"Medical": 300}
    assert report["monthly"][-1]["expense"] == 1200
    assert report["monthly"][-1]["personal_expense"] == 300

    dashboard = client.get("/api/owner/dashboard?hostel_id=hostel-1").json()
    assert dashboard["monthly_expenses"] == 1200
    assert dashboard["monthly_personal_expenses"] == 300
    assert dashboard["monthly_profit"] == 3800

    portfolio = client.get("/api/owner/portfolio").json()
    assert portfolio["total_expenses"] == 1200
    assert portfolio["personal_expenses"] == 300
    assert portfolio["net_profit"] == 3800


def test_expense_purpose_is_validated_and_can_be_expense_specific(expense_db):
    client = TestClient(server.app)
    client.post("/api/owner/expense-categories", json={
        "hostel_id": "hostel-1", "name": "Travels", "purpose": "property",
    })
    response = client.post("/api/owner/expenses", json={
        "hostel_id": "hostel-1", "category": "Travels", "amount": 100,
        "purpose": "not-a-purpose",
    })
    assert response.status_code == 422
    personal = client.post("/api/owner/expenses", json={
        "hostel_id": "hostel-1", "category": "Travels", "amount": 100,
        "purpose": "personal",
    })
    assert personal.status_code == 200
    assert personal.json()["expense"]["purpose"] == "personal"
    assert expense_db.expense_categories.documents[0]["purpose"] == "property"


def test_legacy_expenses_remain_unclassified_until_reviewed(expense_db):
    expense_db.expenses.documents.append({
        "id": "legacy-expense", "hostel_id": "hostel-1",
        "category": "Maintenance", "amount": 450, "date": server.now_utc().isoformat(),
    })
    client = TestClient(server.app)
    report = client.get("/api/owner/reports?hostel_id=hostel-1").json()
    assert report["total_expenses"] == 0
    assert report["personal_expenses"] == 0
    assert report["unclassified_expenses"] == 450
    assert report["net_profit"] == 0
    assert report["unclassified_expense_by_category"] == {"Maintenance": 450}
    assert report["monthly"][-1]["unclassified_expense"] == 450
    dashboard = client.get("/api/owner/dashboard?hostel_id=hostel-1").json()
    assert dashboard["monthly_unclassified_expenses"] == 450
    portfolio = client.get("/api/owner/portfolio").json()
    assert portfolio["total_expenses"] == 0
    assert portfolio["unclassified_expenses"] == 450


def test_legacy_custom_category_requires_explicit_expense_purpose(expense_db):
    expense_db.expense_categories.documents.append({
        "id": "legacy-category",
        "owner_id": "owner-1",
        "hostel_id": "hostel-1",
        "name": "Old travel",
        "normalized_name": "old travel",
    })
    client = TestClient(server.app)
    missing_purpose = client.post("/api/owner/expenses", json={
        "hostel_id": "hostel-1", "category": "Old travel", "amount": 200,
    })
    assert missing_purpose.status_code == 400
    assert missing_purpose.json()["detail"] == "Select a purpose for this expense"

    selected = client.post("/api/owner/expenses", json={
        "hostel_id": "hostel-1", "category": "Old travel", "amount": 200,
        "purpose": "personal",
    })
    assert selected.status_code == 200
    assert selected.json()["expense"]["purpose"] == "personal"
