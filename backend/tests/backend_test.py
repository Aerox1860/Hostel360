"""Hostel 360 backend test suite (pytest).

Covers: auth, public search, admin, owner CRUD, tenant, payments (400 when Stripe not configured).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://pg-manager-35.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@hostel360.com", "password": "Admin@12345"}
OWNER = {"email": "owner@hostel360.com", "password": "Owner@12345"}
TENANT = {"email": "tenant@hostel360.com", "password": "Tenant@12345"}


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login(s, creds):
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


@pytest.fixture(scope="session")
def admin_token(s):
    t, _ = _login(s, ADMIN)
    return t


@pytest.fixture(scope="session")
def owner_token(s):
    t, _ = _login(s, OWNER)
    return t


@pytest.fixture(scope="session")
def tenant_token(s):
    t, _ = _login(s, TENANT)
    return t


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- Auth ----------------
class TestAuth:
    def test_admin_login(self, s):
        tok, u = _login(s, ADMIN)
        assert u["role"] == "admin"

    def test_owner_login(self, s):
        _, u = _login(s, OWNER)
        assert u["role"] == "owner"

    def test_tenant_login(self, s):
        _, u = _login(s, TENANT)
        assert u["role"] == "tenant"

    def test_wrong_password(self, s):
        r = s.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "bad"})
        assert r.status_code == 401

    def test_me(self, s, admin_token):
        r = s.get(f"{API}/auth/me", headers=h(admin_token))
        assert r.status_code == 200
        assert r.json()["user"]["email"] == ADMIN["email"]

    def test_me_no_token(self, s):
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_register_tenant(self, s):
        email = f"TEST_tenant_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": "Pass@12345", "name": "Test T", "role": "tenant"})
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "tenant"

    def test_register_owner(self, s):
        email = f"TEST_owner_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": "Pass@12345", "name": "Test O", "role": "owner"})
        assert r.status_code == 200

    def test_register_admin_forbidden(self, s):
        # Schema restricts role literal → 422
        email = f"TEST_a_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={
            "email": email, "password": "Pass@12345", "name": "T", "role": "admin"})
        assert r.status_code == 422


# ---------------- Public ----------------
class TestPublic:
    def test_list(self, s):
        r = s.get(f"{API}/public/hostels")
        assert r.status_code == 200
        hostels = r.json()["hostels"]
        assert isinstance(hostels, list)
        assert len(hostels) >= 1
        assert all(x["status"] == "approved" for x in hostels)

    def test_filter_city(self, s):
        r = s.get(f"{API}/public/hostels", params={"city": "Bengaluru"})
        assert r.status_code == 200
        for hh in r.json()["hostels"]:
            assert "bengaluru" in hh["city"].lower()

    def test_filter_gender_boys(self, s):
        r = s.get(f"{API}/public/hostels", params={"gender": "boys"})
        assert r.status_code == 200
        for hh in r.json()["hostels"]:
            assert hh["gender"] == "boys"

    def test_filter_max_budget(self, s):
        r = s.get(f"{API}/public/hostels", params={"max_budget": 6000})
        assert r.status_code == 200
        for hh in r.json()["hostels"]:
            assert (hh.get("min_rent") or 0) <= 6000

    def test_detail(self, s):
        r = s.get(f"{API}/public/hostels")
        hid = r.json()["hostels"][0]["id"]
        d = s.get(f"{API}/public/hostels/{hid}")
        assert d.status_code == 200
        hostel = d.json()["hostel"]
        assert "reviews" in hostel
        assert "available_beds" in hostel
        assert "room_options" in hostel

    def test_enquiry(self, s):
        r = s.get(f"{API}/public/hostels").json()["hostels"]
        hid = r[0]["id"]
        er = s.post(f"{API}/public/enquiry", json={
            "hostel_id": hid, "name": "TEST_Visitor", "mobile": "9999911111",
            "type": "enquiry", "message": "Interested"})
        assert er.status_code == 200
        assert er.json()["ok"] is True


# ---------------- Admin ----------------
class TestAdmin:
    def test_dashboard(self, s, admin_token):
        r = s.get(f"{API}/admin/dashboard", headers=h(admin_token))
        assert r.status_code == 200
        d = r.json()
        for k in ("total_hostels", "total_owners", "pending_verification"):
            assert k in d

    def test_hostels_pending(self, s, admin_token):
        r = s.get(f"{API}/admin/hostels", params={"status_filter": "pending"}, headers=h(admin_token))
        assert r.status_code == 200
        hs = r.json()["hostels"]
        assert all(x["status"] == "pending" for x in hs)

    def test_verify_approve_then_suspend_reactivate(self, s, admin_token):
        # find a pending hostel
        hs = s.get(f"{API}/admin/hostels", params={"status_filter": "pending"}, headers=h(admin_token)).json()["hostels"]
        if not hs:
            pytest.skip("No pending hostel to approve")
        hid = hs[0]["id"]
        r = s.post(f"{API}/admin/hostels/{hid}/verify", json={"action": "approve"}, headers=h(admin_token))
        assert r.status_code == 200
        assert r.json()["hostel"]["status"] == "approved"
        # suspend
        r2 = s.post(f"{API}/admin/hostels/{hid}/verify", json={"action": "suspend"}, headers=h(admin_token))
        assert r2.json()["hostel"]["status"] == "suspended"
        # reactivate
        r3 = s.post(f"{API}/admin/hostels/{hid}/verify", json={"action": "reactivate"}, headers=h(admin_token))
        assert r3.json()["hostel"]["status"] == "approved"

    def test_owners(self, s, admin_token):
        r = s.get(f"{API}/admin/owners", headers=h(admin_token))
        assert r.status_code == 200
        assert len(r.json()["owners"]) >= 1

    def test_plans_crud(self, s, admin_token):
        # create
        payload = {"name": "TEST_Plan", "duration_months": 2, "price": 12.34, "features": ["a"], "active": True}
        r = s.post(f"{API}/admin/plans", json=payload, headers=h(admin_token))
        assert r.status_code == 200
        pid = r.json()["plan"]["id"]
        # update
        payload["price"] = 21.0
        r2 = s.put(f"{API}/admin/plans/{pid}", json=payload, headers=h(admin_token))
        assert r2.status_code == 200 and r2.json()["plan"]["price"] == 21.0
        # toggle
        r3 = s.post(f"{API}/admin/plans/{pid}/toggle", headers=h(admin_token))
        assert r3.status_code == 200

    def test_admin_forbidden_for_tenant(self, s, tenant_token):
        r = s.get(f"{API}/admin/dashboard", headers=h(tenant_token))
        assert r.status_code == 403

    def test_admin_forbidden_for_owner(self, s, owner_token):
        r = s.get(f"{API}/admin/dashboard", headers=h(owner_token))
        assert r.status_code == 403


# ---------------- Owner ----------------
class TestOwner:
    def test_dashboard(self, s, owner_token):
        r = s.get(f"{API}/owner/dashboard", headers=h(owner_token))
        assert r.status_code == 200
        d = r.json()
        assert d["has_hostel"] is True
        assert d["total_rooms"] >= 4

    def test_get_hostel(self, s, owner_token):
        r = s.get(f"{API}/owner/hostel", headers=h(owner_token))
        assert r.status_code == 200
        assert r.json()["hostel"]["name"] == "Green Nest Co-Living"

    def test_room_add_and_delete(self, s, owner_token):
        rno = f"TEST{uuid.uuid4().hex[:4].upper()}"
        payload = {"floor": "3", "room_number": rno, "room_type": "single", "rent": 8888, "bed_count": 1}
        r = s.post(f"{API}/owner/rooms", json=payload, headers=h(owner_token))
        assert r.status_code == 200
        rid = r.json()["room"]["id"]
        # verify list
        rooms = s.get(f"{API}/owner/rooms", headers=h(owner_token)).json()["rooms"]
        assert any(x["id"] == rid for x in rooms)
        # delete
        d = s.delete(f"{API}/owner/rooms/{rid}", headers=h(owner_token))
        assert d.status_code == 200

    def test_tenant_add_transfer_checkout(self, s, owner_token):
        rooms = s.get(f"{API}/owner/rooms", headers=h(owner_token)).json()["rooms"]
        # find room with an available bed
        room = next(r for r in rooms if any(b["status"] == "available" for b in r["beds"]))
        bed = next(b for b in room["beds"] if b["status"] == "available")
        payload = {
            "name": "TEST_Tenant", "mobile": "9990001111",
            "room_id": room["id"], "bed_number": bed["bed_number"],
            "joining_date": "2026-01-01T00:00:00Z", "monthly_rent": room["rent"],
            "security_deposit": 5000, "advance_amount": 1000,
        }
        r = s.post(f"{API}/owner/tenants", json=payload, headers=h(owner_token))
        assert r.status_code == 200, r.text
        tid = r.json()["tenant"]["id"]
        # transfer to another bed if available
        rooms2 = s.get(f"{API}/owner/rooms", headers=h(owner_token)).json()["rooms"]
        target = None
        for rm in rooms2:
            for b in rm["beds"]:
                if b["status"] == "available":
                    target = (rm["id"], b["bed_number"])
                    break
            if target:
                break
        if target:
            tr = s.post(f"{API}/owner/tenants/{tid}/transfer",
                        json={"room_id": target[0], "bed_number": target[1]}, headers=h(owner_token))
            assert tr.status_code == 200
        # checkout
        co = s.post(f"{API}/owner/tenants/{tid}/checkout", headers=h(owner_token))
        assert co.status_code == 200
        # delete
        de = s.delete(f"{API}/owner/tenants/{tid}", headers=h(owner_token))
        assert de.status_code == 200

    def test_rent_collect(self, s, owner_token):
        data = s.get(f"{API}/owner/rent", headers=h(owner_token)).json()
        assert "tenants" in data
        if not data["tenants"]:
            pytest.skip("No active tenants for rent collection")
        tid = data["tenants"][0]["id"]
        r = s.post(f"{API}/owner/rent", json={"tenant_id": tid, "amount": 100, "type": "rent", "method": "cash"},
                   headers=h(owner_token))
        assert r.status_code == 200
        p = r.json()["payment"]
        assert p["receipt_no"].startswith("RCPT-")
        assert p["status"] == "paid"

    def test_expenses(self, s, owner_token):
        r = s.post(f"{API}/owner/expenses",
                   json={"category": "internet", "amount": 500, "note": "TEST"},
                   headers=h(owner_token))
        assert r.status_code == 200
        eid = r.json()["expense"]["id"]
        # verify persisted
        lst = s.get(f"{API}/owner/expenses", headers=h(owner_token)).json()["expenses"]
        assert any(e["id"] == eid for e in lst)
        # delete
        d = s.delete(f"{API}/owner/expenses/{eid}", headers=h(owner_token))
        assert d.status_code == 200

    def test_reports(self, s, owner_token):
        r = s.get(f"{API}/owner/reports", headers=h(owner_token))
        assert r.status_code == 200
        d = r.json()
        assert d["has_hostel"] is True
        for k in ("total_collection", "total_expenses", "monthly", "expense_by_category"):
            assert k in d

    def test_notices(self, s, owner_token):
        r = s.post(f"{API}/owner/notices", json={"title": "TEST_Notice", "body": "hello"}, headers=h(owner_token))
        assert r.status_code == 200

    def test_owner_forbidden_tenant_route(self, s, owner_token):
        r = s.get(f"{API}/tenant/home", headers=h(owner_token))
        assert r.status_code == 403

    def test_enquiries(self, s, owner_token):
        r = s.get(f"{API}/owner/enquiries", headers=h(owner_token))
        assert r.status_code == 200
        assert "enquiries" in r.json()


# ---------------- Tenant ----------------
class TestTenant:
    def test_home(self, s, tenant_token):
        r = s.get(f"{API}/tenant/home", headers=h(tenant_token))
        assert r.status_code == 200
        d = r.json()
        assert d["has_allocation"] is True
        assert d["hostel"]["name"] == "Green Nest Co-Living"

    def test_payments(self, s, tenant_token):
        r = s.get(f"{API}/tenant/payments", headers=h(tenant_token))
        assert r.status_code == 200
        assert isinstance(r.json()["payments"], list)

    def test_notices(self, s, tenant_token):
        r = s.get(f"{API}/tenant/notices", headers=h(tenant_token))
        assert r.status_code == 200

    def test_complaint_flow(self, s, tenant_token, owner_token):
        r = s.post(f"{API}/tenant/complaints",
                   json={"title": "TEST_Cx", "body": "water"}, headers=h(tenant_token))
        assert r.status_code == 200
        cid = r.json()["complaint"]["id"]
        # owner sees it
        oc = s.get(f"{API}/owner/complaints", headers=h(owner_token)).json()
        assert any(c["id"] == cid for c in oc["complaints"])
        # owner resolves
        rr = s.post(f"{API}/owner/complaints/{cid}/resolve", headers=h(owner_token))
        assert rr.status_code == 200

    def test_request(self, s, tenant_token):
        r = s.post(f"{API}/tenant/requests", json={"type": "room_change", "note": "TEST"}, headers=h(tenant_token))
        assert r.status_code == 200


# ---------------- Payments ----------------
class TestPayments:
    def test_sub_checkout_400(self, s, owner_token):
        # Grab any plan id
        plans = s.get(f"{API}/plans").json()["plans"]
        assert plans, "no plans seeded"
        r = s.post(f"{API}/payments/subscription/checkout",
                   json={"plan_id": plans[0]["id"]}, headers=h(owner_token))
        assert r.status_code == 400
        assert "not configured" in r.json().get("detail", "").lower()

    def test_rent_checkout_400(self, s, tenant_token):
        r = s.post(f"{API}/payments/rent/checkout", json={}, headers=h(tenant_token))
        assert r.status_code == 400
        assert "not configured" in r.json().get("detail", "").lower()

    def test_sub_checkout_requires_owner(self, s, tenant_token):
        plans = s.get(f"{API}/plans").json()["plans"]
        r = s.post(f"{API}/payments/subscription/checkout",
                   json={"plan_id": plans[0]["id"]}, headers=h(tenant_token))
        assert r.status_code == 403
