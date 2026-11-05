# Hostel360 Web

Independent responsive React/Vite frontend for the existing Hostel360 API. It
shares the current authentication and backend data model; it does not create a
separate database or backend.

## Local development

From Windows PowerShell:

```powershell
Set-Location C:\hostel360\Hostel360\frontend-web
Copy-Item .env.example .env
npm install
npm run dev
```

The local Vite proxy sends `/api` requests to `http://localhost:8000` by default.
Start the existing FastAPI backend separately. Set `VITE_API_ORIGIN` in the
local `.env` only when intentionally using another non-production API.

Create a production build with:

```powershell
npm run build
```

The static output is `dist`. For a production build, configure the build
environment with `VITE_API_ORIGIN=https://api.golivehostel360.com` only after
the frontend host, backend CORS origin, OAuth settings, and deployment have
been reviewed and approved. This project has not been deployed.

## Browser authentication and Google Sign-In

The application reuses the backend `/api/auth/*` endpoints and stores the
bearer access token in browser `localStorage`, matching the standalone web
client scaffold. Serve production only over HTTPS, restrict allowed origins,
and deploy a suitable Content Security Policy. Browser storage is accessible
to same-origin JavaScript, so XSS prevention remains important.

Direct Google Sign-In is intentionally disabled by default. To enable it,
configure `VITE_GOOGLE_DIRECT_SIGNIN_ENABLED=true` and the public
`VITE_GOOGLE_WEB_CLIENT_ID`, add the web origin to the Google OAuth client's
authorized JavaScript origins, and configure the matching OAuth audience in
the backend. Never place a Google client secret in this frontend.

## Mobile-to-web route parity

| Mobile flow | Web route |
|---|---|
| Public explore, favorites, property details, enquiry/site visit/callback | `/explore`, `/favorites`, `/hostel/:id` |
| Login, registration, Google sign-in, password change, account | `/login`, `/register`, `/change-password`, `/account` |
| Owner dashboard, properties, rooms/beds, tenant list and management | `/owner`, `/owner/rooms`, `/owner/tenants` |
| Owner rent, payment approval, expenses and manual food-product amounts | `/owner/money` |
| Owner notices, complaints/requests, enquiries and subscriptions | `/owner/more` |
| Referrals, tenant registration QR/applications, alerts and rules | `/owner/referrals`, `/owner/tenant-registration`, `/owner/tenant-alerts`, `/owner/rules` |
| Tenant home, rent payment/history, notices, complaints/requests | `/tenant`, `/tenant/payments`, `/tenant/notices`, `/tenant/complaints` |
| Tenant history-sharing consent and required policy acknowledgement | `/tenant/history-sharing`, `/tenant/policy-review` |
| Admin dashboard, hostel verification, owners, plans, ads and referrals | `/admin`, `/admin/hostels`, `/admin/owners`, `/admin/plans`, `/admin/advertisements`, `/admin/referrals` |

Authorization and owner/tenant data isolation remain enforced by the existing
backend. The web client does not send a frontend-selected `owner_id` as proof
of access; hostel IDs are only selection parameters and are validated by the
authenticated API.
