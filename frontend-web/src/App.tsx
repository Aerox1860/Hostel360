import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AlertMessage, Button, ProtectedLayout, Brand } from "./ui";
import { useAuth } from "./state";
import { api } from "./api";
import { AccountPage, ChangePasswordPage, LoginPage, RegisterPage } from "./pages/auth";
import { ExplorePage, FavoritesPage, HostelDetailPage, LandingPage, TenantApplicationPage } from "./pages/public";
import {
  OwnerDashboardPage, OwnerRoomsPage, OwnerTenantsPage, OwnerMoneyPage,
} from "./pages/owner";
import {
  OwnerMorePage, OwnerReferralsPage, OwnerRegistrationPage, OwnerAlertsPage, OwnerRulesPage,
} from "./pages/owner-extra";
import {
  TenantHomePage, TenantPaymentsPage, TenantNoticesPage, TenantSupportPage,
  TenantHistorySharingPage, TenantPolicyPage,
} from "./pages/tenant";
import {
  AdminDashboardPage, AdminHostelsPage, AdminOwnersPage, AdminPlansPage,
  AdminAdvertisementsPage, AdminReferralsPage,
} from "./pages/admin";
import { OwnerProvider } from "./owner-state";
import { TenantPolicyContext, TenantPolicyContextValue, TenantPolicyStatus } from "./tenant-policy-state";

function PublicLayout() {
  const location = useLocation();
  return <>{location.pathname !== "/" && <header className="topbar"><Brand /></header>}<Outlet /></>;
}

function OwnerArea() {
  return <OwnerProvider><Outlet /></OwnerProvider>;
}

function TenantArea() {
  const { user } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState<TenantPolicyStatus>("checking");
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(async () => {
    if (!user) return;
    setStatus("checking");
    try {
      const result = await api.get<{ required: boolean }>("/tenant/rules/pending");
      setStatus(result.required ? "required" : "allowed");
    } catch {
      setStatus("error");
    }
  }, [user]);
  useEffect(() => { void refresh(); }, [refresh, attempt]);
  const context = useMemo<TenantPolicyContextValue>(() => ({
    status,
    setStatus: (value: "allowed" | "required") => setStatus(value),
    retry: () => setAttempt((current) => current + 1),
  }), [status]);
  if (status === "checking") return <div className="centered">Checking the latest hostel rules…</div>;
  if ((status === "required" || status === "error") && location.pathname !== "/tenant/policy-review") {
    return <Navigate to="/tenant/policy-review" replace />;
  }
  if (status === "error" && location.pathname === "/tenant/policy-review") {
    return <TenantPolicyContext.Provider value={context}><div className="workspace-content"><AlertMessage tone="error">Could not check the current hostel rules. Retry before continuing.</AlertMessage><Button onClick={context.retry}>Retry</Button></div></TenantPolicyContext.Provider>;
  }
  return <TenantPolicyContext.Provider value={context}><Outlet /></TenantPolicyContext.Provider>;
}

function HomeRedirect() {
  const { user, loading, error, refresh } = useAuth();
  if (loading) return <div className="centered">Loading Hostel360…</div>;
  if (error) return <main className="page"><AlertMessage tone="error">Could not restore your sign-in session: {error}</AlertMessage><Button onClick={() => void refresh()}>Retry</Button></main>;
  return <Navigate to={user?.role === "admin" ? "/admin" : user?.role === "owner" ? "/owner" : user ? "/tenant" : "/explore"} replace />;
}

export default function App() {
  return <Routes>
    <Route element={<PublicLayout />}>
      <Route path="/" element={<LandingPage />} />
      <Route path="/explore" element={<ExplorePage />} />
      <Route path="/favorites" element={<FavoritesPage />} />
      <Route path="/hostel/:id" element={<HostelDetailPage />} />
      <Route path="/apply" element={<TenantApplicationPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
    </Route>
    <Route element={<ProtectedLayout role="owner" />}>
      <Route element={<OwnerArea />}>
        <Route path="/owner" element={<OwnerDashboardPage />} />
        <Route path="/owner/rooms" element={<OwnerRoomsPage />} />
        <Route path="/owner/tenants" element={<OwnerTenantsPage />} />
        <Route path="/owner/money" element={<OwnerMoneyPage />} />
        <Route path="/owner/more" element={<OwnerMorePage />} />
        <Route path="/owner/referrals" element={<OwnerReferralsPage />} />
        <Route path="/owner/tenant-registration" element={<OwnerRegistrationPage />} />
        <Route path="/owner/tenant-alerts" element={<OwnerAlertsPage />} />
        <Route path="/owner/rules" element={<OwnerRulesPage />} />
      </Route>
    </Route>
    <Route element={<ProtectedLayout role="tenant" />}>
      <Route element={<TenantArea />}>
        <Route path="/tenant" element={<TenantHomePage />} />
        <Route path="/tenant/payments" element={<TenantPaymentsPage />} />
        <Route path="/tenant/notices" element={<TenantNoticesPage />} />
        <Route path="/tenant/complaints" element={<TenantSupportPage />} />
        <Route path="/tenant/history-sharing" element={<TenantHistorySharingPage />} />
        <Route path="/tenant/policy-review" element={<TenantPolicyPage />} />
      </Route>
    </Route>
    <Route element={<ProtectedLayout role="admin" />}>
      <Route path="/admin" element={<AdminDashboardPage />} />
      <Route path="/admin/hostels" element={<AdminHostelsPage />} />
      <Route path="/admin/owners" element={<AdminOwnersPage />} />
      <Route path="/admin/plans" element={<AdminPlansPage />} />
      <Route path="/admin/advertisements" element={<AdminAdvertisementsPage />} />
      <Route path="/admin/referrals" element={<AdminReferralsPage />} />
    </Route>
    <Route path="*" element={<HomeRedirect />} />
  </Routes>;
}
