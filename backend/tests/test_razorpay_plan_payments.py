import asyncio
import os
import sys
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "hostel360_razorpay_tests")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server


OWNER = {"id": "owner-1", "role": "owner", "name": "Test Owner", "email": "owner@example.test"}
ADMIN = {"id": "admin-1", "role": "admin"}
HOSTEL = {
    "id": "hostel-1",
    "owner_id": "owner-1",
    "name": "Test Hostel",
    "plan_expiry": None,
}
PLAN = {
    "id": "plan-3m",
    "name": "Quarterly Premium",
    "duration_months": 3,
    "price": 1234.56,
    "gst_rate": 18,
    "features": [],
    "active": True,
}


def matches(document, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(matches(document, clause) for clause in expected):
                return False
            continue
        actual = document
        for part in key.split("."):
            actual = actual.get(part) if isinstance(actual, dict) else None
        if isinstance(expected, dict):
            if "$exists" in expected and (key in document) != expected["$exists"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$lt" in expected and (actual is None or actual >= expected["$lt"]):
                return False
        elif actual != expected:
            return False
    return True


class Cursor:
    def __init__(self, documents):
        self.documents = documents

    def sort(self, key, direction):
        self.documents.sort(key=lambda doc: doc.get(key), reverse=direction < 0)
        return self

    async def to_list(self, length):
        return deepcopy(self.documents if length is None else self.documents[:length])


class Collection:
    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return Cursor([doc for doc in self.documents if matches(doc, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        document = next((doc for doc in self.documents if matches(doc, query)), None)
        return deepcopy(document)

    async def insert_one(self, document):
        self.documents.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update, upsert=False):
        await asyncio.sleep(0)
        document = next((doc for doc in self.documents if matches(doc, query)), None)
        if not document:
            return SimpleNamespace(matched_count=0, modified_count=0)
        document.update(deepcopy(update.get("$set", {})))
        for key in update.get("$unset", {}):
            document.pop(key, None)
        return SimpleNamespace(matched_count=1, modified_count=1)


@pytest.fixture
def payment_setup(monkeypatch):
    db = SimpleNamespace(
        hostels=Collection([HOSTEL]),
        rooms=Collection(),
        plans=Collection([PLAN]),
        rp_payments=Collection(),
        subscriptions=Collection(),
    )
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setattr(server, "RAZORPAY_KEY_SECRET", "test_secret")
    monkeypatch.setattr(server, "RAZORPAY_WEBHOOK_SECRET", "webhook_secret")
    monkeypatch.setattr(server, "BACKEND_URL", "https://api.example.test")

    provider = SimpleNamespace(created_payload=None, link=None)

    class FakePaymentLink:
        def create(self, payload):
            provider.created_payload = deepcopy(payload)
            provider.link = {
                "id": "plink_test_1",
                "short_url": "https://rzp.io/i/test-link",
            }
            return provider.link

        def fetch(self, payment_link_id):
            assert payment_link_id == "plink_test_1"
            return deepcopy(provider.link)

    class FakeClient:
        def __init__(self, auth):
            assert auth == ("rzp_test_key", "test_secret")
            self.payment_link = FakePaymentLink()

    import razorpay

    monkeypatch.setattr(razorpay, "Client", FakeClient)
    return db, provider


def test_plan_payment_link_uses_database_price_and_dynamic_plan(payment_setup):
    db, provider = payment_setup

    result = asyncio.run(
        server.create_sub_link(server.SubLinkBody(hostel_id="hostel-1", plan_id="plan-3m"), OWNER)
    )

    assert provider.created_payload["amount"] == 145678
    assert provider.created_payload["currency"] == "INR"
    assert provider.created_payload["description"] == "Hostel 360 - Quarterly Premium - 3 month(s)"
    assert result == {
        "payment_link_id": "plink_test_1",
        "checkout_url": "https://rzp.io/i/test-link",
        "plan_id": "plan-3m",
        "base_price": 1234.56,
        "base_price_paise": 123456,
        "gst_rates": [18],
        "gst_rate": 18,
        "charge_type": "gst",
        "gst_amount": 222.22,
        "gst_amount_paise": 22222,
        "total_amount": 1456.78,
        "total_amount_paise": 145678,
        "amount": 1456.78,
        "currency": "INR",
    }
    assert db.rp_payments.documents[0]["base_price"] == 1234.56
    assert db.rp_payments.documents[0]["base_price_paise"] == 123456
    assert db.rp_payments.documents[0]["gst_rate"] == 18
    assert db.rp_payments.documents[0]["gst_amount"] == 222.22
    assert db.rp_payments.documents[0]["gst_amount_paise"] == 22222
    assert db.rp_payments.documents[0]["total_amount"] == 1456.78
    assert db.rp_payments.documents[0]["amount_paise"] == 145678
    assert db.rp_payments.documents[0]["months"] == 3


def test_two_percent_gst_is_added_once_in_paise(payment_setup):
    db, provider = payment_setup
    db.plans.documents[0]["gst_rate"] = 2

    result = asyncio.run(
        server.create_sub_link(server.SubLinkBody(hostel_id="hostel-1", plan_id="plan-3m"), OWNER)
    )

    assert result["base_price"] == 1234.56
    assert result["base_price_paise"] == 123456
    assert result["gst_rate"] == 2
    assert result["charge_type"] == "gst"
    assert result["gst_amount"] == 24.69
    assert result["gst_amount_paise"] == 2469
    assert result["total_amount"] == 1259.25
    assert provider.created_payload["amount"] == result["total_amount_paise"] == 125925
    assert db.rp_payments.documents[0]["amount"] == 1259.25
    assert db.rp_payments.documents[0]["charge_type"] == "gst"


def test_one_thousand_rupee_plan_with_eighteen_percent_is_1180(payment_setup):
    db, provider = payment_setup
    db.plans.documents[0]["price"] = 1000

    result = asyncio.run(server.create_sub_link(
        server.SubLinkBody(
            hostel_id="hostel-1",
            plan_id="plan-3m",
            expected_base_price_paise=100000,
            expected_gst_rate=18,
            expected_gst_amount_paise=18000,
            expected_total_amount_paise=118000,
        ),
        OWNER,
    ))

    assert result["base_price"] == 1000
    assert result["gst_rate"] == 18
    assert result["gst_rates"] == [18]
    assert result["charge_type"] == "gst"
    assert result["gst_amount"] == 180
    assert result["gst_amount_paise"] == 18000
    assert result["total_amount"] == 1180
    assert provider.created_payload["amount"] == 118000


def test_stale_displayed_total_does_not_create_razorpay_link(payment_setup):
    db, provider = payment_setup

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.create_sub_link(
            server.SubLinkBody(
                hostel_id="hostel-1",
                plan_id="plan-3m",
                expected_total_amount_paise=123456,
            ),
            OWNER,
        ))

    assert exc.value.status_code == 409
    assert provider.created_payload is None
    assert not db.rp_payments.documents


def test_owner_subscription_returns_active_database_plans(payment_setup):
    db, _ = payment_setup
    db.plans.documents.append({**PLAN, "id": "inactive-plan", "active": False})

    result = asyncio.run(server.owner_subscription("hostel-1", OWNER))

    assert result["plans"][0]["id"] == PLAN["id"]
    assert result["plans"][0]["price"] == 1234.56
    assert result["plans"][0]["base_price"] == 1234.56
    assert result["plans"][0]["base_price_paise"] == 123456
    assert result["plans"][0]["gst_rate"] == 18
    assert result["plans"][0]["gst_rates"] == [18]
    assert result["plans"][0]["charge_type"] == "gst"
    assert result["plans"][0]["gst_amount"] == 222.22
    assert result["plans"][0]["gst_amount_paise"] == 22222
    assert result["plans"][0]["total_amount"] == 1456.78


def test_admin_saves_selected_plan_gst_rate(payment_setup):
    db, _ = payment_setup

    plan = server.PlanBody(
        name="Quarterly Premium", duration_months=3, price=1234.56, gst_rate=2, features=[]
    )
    updated = asyncio.run(server.update_plan("plan-3m", plan, ADMIN))
    assert updated["plan"]["gst_rate"] == 2
    assert updated["plan"]["gst_rates"] == [2]
    assert updated["plan"]["charge_type"] == "gst"
    assert db.plans.documents[0]["price"] == 1234.56

    created = asyncio.run(server.create_plan(
        server.PlanBody(name="Annual", duration_months=12, price=1000, gst_rate=18),
        ADMIN,
    ))
    assert created["plan"]["gst_rate"] == 18
    assert created["plan"]["gst_rates"] == [18]
    assert created["plan"]["charge_type"] == "gst"
    assert db.plans.documents[1]["price"] == 1000


def test_plan_requires_supported_gst_rate():
    with pytest.raises(ValidationError):
        server.PlanBody(name="Invalid", duration_months=1, price=1000)
    with pytest.raises(ValidationError):
        server.PlanBody(name="Invalid", duration_months=1, price=1000, gst_rate=5)
    with pytest.raises(ValidationError):
        server.PlanBody(name="Invalid", duration_months=1, price=1000, gst_rates=[])


def test_admin_can_save_both_gst_rates_and_checkout_adds_them(payment_setup):
    db, provider = payment_setup
    db.plans.documents[0]["price"] = 1000

    plan = server.PlanBody(
        name="Quarterly Premium", duration_months=3, price=1000, gst_rates=[18, 2]
    )
    updated = asyncio.run(server.update_plan("plan-3m", plan, ADMIN))
    assert updated["plan"]["gst_rates"] == [2, 18]
    assert updated["plan"]["gst_rate"] == 20

    displayed = server._plan_price_breakdown(updated["plan"])
    assert displayed["gst_amount"] == 200
    assert displayed["total_amount"] == 1200

    result = asyncio.run(server.create_sub_link(
        server.SubLinkBody(
            hostel_id="hostel-1",
            plan_id="plan-3m",
            expected_gst_rates=[2, 18],
            expected_gst_rate=20,
            expected_gst_amount_paise=20000,
            expected_total_amount_paise=120000,
        ),
        OWNER,
    ))
    assert result["gst_rates"] == [2, 18]
    assert result["gst_rate"] == 20
    assert result["gst_amount"] == 200
    assert result["total_amount"] == 1200
    assert provider.created_payload["amount"] == 120000
    assert db.rp_payments.documents[0]["gst_rates"] == [2, 18]


def test_unconfigured_legacy_plan_is_visible_but_checkout_is_blocked(payment_setup):
    db, _ = payment_setup
    db.plans.documents[0].pop("gst_rate")
    plan = server._plan_price_breakdown(db.plans.documents[0])
    assert plan["base_price"] == 1234.56
    assert plan["gst_rate"] is None
    assert plan["total_amount"] is None

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.create_sub_link(
            server.SubLinkBody(hostel_id="hostel-1", plan_id="plan-3m"), OWNER
        ))
    assert exc.value.status_code == 409
    assert not db.rp_payments.documents


def test_plan_payment_link_rejects_hostel_or_plan_not_owned_and_active(payment_setup):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.create_sub_link(server.SubLinkBody(hostel_id="other-hostel", plan_id="plan-3m"), OWNER)
        )
    assert exc.value.status_code == 404

    db, _ = payment_setup
    db.plans.documents[0]["active"] = False
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.create_sub_link(server.SubLinkBody(hostel_id="hostel-1", plan_id="plan-3m"), OWNER)
        )
    assert exc.value.status_code == 404


def test_plan_payment_link_rejects_invalid_database_price(payment_setup):
    db, _ = payment_setup
    db.plans.documents[0]["price"] = 1234.567

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.create_sub_link(server.SubLinkBody(hostel_id="hostel-1", plan_id="plan-3m"), OWNER)
        )

    assert exc.value.status_code == 422


def test_paid_link_is_verified_and_activates_database_plan_once(payment_setup):
    db, provider = payment_setup
    asyncio.run(server.create_sub_link(server.SubLinkBody(hostel_id="hostel-1", plan_id="plan-3m"), OWNER))
    payment = db.rp_payments.documents[0]
    provider.link.update({
        "reference_id": payment["reference_id"],
        "status": "paid",
        "currency": "INR",
        "amount": 145678,
        "amount_paid": 145678,
    })

    async def check_statuses():
        return await asyncio.gather(
            server.sub_status("plink_test_1", OWNER),
            server.sub_status("plink_test_1", OWNER),
        )

    results = asyncio.run(check_statuses())

    assert all(result["status"] in ("paid", "processing") for result in results)
    assert any(result["activated"] for result in results)
    assert len(db.subscriptions.documents) == 1
    assert db.subscriptions.documents[0]["amount"] == 1456.78
    assert db.subscriptions.documents[0]["base_price"] == 1234.56
    assert db.subscriptions.documents[0]["base_price_paise"] == 123456
    assert db.subscriptions.documents[0]["gst_rate"] == 18
    assert db.subscriptions.documents[0]["charge_type"] == "gst"
    assert db.subscriptions.documents[0]["gst_amount"] == 222.22
    assert db.subscriptions.documents[0]["gst_amount_paise"] == 22222
    assert db.subscriptions.documents[0]["total_amount"] == 1456.78
    assert db.subscriptions.documents[0]["amount_paise"] == 145678
    assert db.subscriptions.documents[0]["plan_id"] == "plan-3m"
    assert db.subscriptions.documents[0]["plan_name"] == "Quarterly Premium"
    assert db.hostels.documents[0]["premium_plan"] == "Quarterly Premium"


def test_paid_link_with_mismatched_amount_does_not_activate(payment_setup):
    db, provider = payment_setup
    asyncio.run(server.create_sub_link(server.SubLinkBody(hostel_id="hostel-1", plan_id="plan-3m"), OWNER))
    payment = db.rp_payments.documents[0]
    provider.link.update({
        "reference_id": payment["reference_id"],
        "status": "paid",
        "currency": "INR",
        "amount": 1,
        "amount_paid": 1,
    })

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.sub_status("plink_test_1", OWNER))

    assert exc.value.status_code == 409
    assert not db.subscriptions.documents
    assert not payment["activated"]
