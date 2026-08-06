# Hostel 360 — Product Requirements & Progress

## Original Problem Statement
Commercial Hostel/PG Management System "Hostel 360" with 4 roles: Admin (platform owner), Building/Hostel Owner, Tenant, and Public visitors. Full spec includes admin verification & plans & owner management; owner rooms/tenants/rent/expenses/reports/notices; tenant self-service; public search & enquiry.

## User Choices
- Build all 4 roles functionally in v1.
- Auth: JWT email/password + Emergent-managed Google login.
- Location: text only for now (live Google Maps later).
- Payments: real online payments via Stripe.
- Theme/logo: agent-designed (Deep Emerald "Hostel 360").

## Architecture
- **Backend**: FastAPI + MongoDB (motor), single `server.py`. UUID string IDs (no ObjectId), `_id` excluded. JWT HS256 with role dependency + Emergent Google session fallback. Idempotent admin seed + demo data seed. Stripe Checkout Sessions (inactive until key added).
- **Frontend**: Expo Router (file-based), 4 role tab groups + `(auth)` + `(public)` + shared `hostel/[id]`. AuthContext, Toast provider, KeyboardProvider. Plus Jakarta Sans fonts. Reusable UI kit in `src/components/ui.tsx`.

## User Personas
- **Admin**: verifies hostels, manages subscription plans and owner accounts, monitors platform revenue.
- **Owner**: manages one hostel — rooms/beds, tenants, rent collection, expenses, reports, notices, complaints, plan upgrade.
- **Tenant**: views room/rent status, pays rent, downloads receipts, raises complaints, requests room change/checkout, reads notices.
- **Visitor**: searches/filters hostels, views details, saves favorites, sends enquiry/site-visit/callback.

## Implemented (2026-06-06)
- Auth: register/login/me, role routing, Google login wired, admin seed. Roles: admin/owner/tenant.
- Public: search + filter chips (gender/sharing/query), image hostel cards, verified badge, detail (photos, room types, amenities, reviews), enquiry sheet, favorites.
- Admin: dashboard KPIs, hostel list + verify (approve/reject/suspend/reactivate), subscription plans CRUD + toggle, owner management (activate/deactivate/block/unblock/reset password).
- Owner: dashboard (occupancy + financial KPIs), hostel onboarding/edit, rooms + bed allocation, tenants (add/edit/transfer/checkout/delete + optional login), rent collection with auto receipts, expense tracking (9 categories), reports (collection/expenses/profit/occupancy/monthly), notices, complaints/requests resolve, enquiries, plan upgrade.
- Tenant: room & rent status, payment history/receipts, raise complaint, room-change/checkout requests, notices, pay rent (Stripe).
- Payments: Stripe checkout for owner subscriptions + tenant rent (returns friendly 400 until key configured).
- Demo data seeded (owner + approved hostel + 4 rooms + tenant + 3 extra hostels + 1 pending).

## Backlog (prioritized)
- **P0**: Add real Stripe test key to activate payments; verify webhook fulfillment end-to-end.
- **P1**: Live Google Maps location picker & map view; hostel photo upload (base64/object storage); receipt PDF download/share.
- **P1**: Admin — deeper verification (view uploaded ownership proof/ID docs), suspend reasons, revenue charts.
- **P2**: Tenant online rent auto-reminders; reviews from verified tenants only; multi-hostel support per owner.
- **P2**: Split `server.py` into role routers; migrate deprecated RN-Web shadow props to boxShadow.

## Test Credentials
See `/app/memory/test_credentials.md`.
