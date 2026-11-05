import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { ActivityIndicator, AppState, Platform, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Redirect, router, usePathname, useSegments } from "expo-router";
import { ApiError, api, setToken } from "@/src/api/client";
import { isDirectGoogleSignInConfigured, signInWithGoogle } from "@/src/auth/googleSignIn";

WebBrowser.maybeCompleteAuthSession();

export type Role = "admin" | "owner" | "tenant";
export interface User {
  id: string;
  email: string;
  name?: string;
  mobile?: string;
  role: Role;
  hostel_id?: string | null;
  blocked?: boolean;
  active?: boolean;
  auth_provider?: string;
  must_change_password?: boolean;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (body: {
    email: string;
    password: string;
    name: string;
    mobile?: string;
    role: "owner" | "tenant";
  }) => Promise<User>;
  changeTenantPassword: (currentPassword: string, newPassword: string) => Promise<User>;
  loginWithGoogle: (propertyId?: string) => Promise<void>;
  loginWithGoogleToken: (idToken: string, propertyId?: string) => Promise<void>;
  linkPendingGoogleAccount: () => Promise<void>;
  googleLinkPending: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshPolicyStatus: () => Promise<"allowed" | "required" | "error">;
  completePolicyReview: () => void;
  policyStatus: PolicyStatus;
  policyUserId: string | null;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);
export const useAuth = () => useContext(Ctx);
type PolicyStatus = "idle" | "checking" | "allowed" | "required" | "error";

export function routeForRole(role: Role) {
  if (role === "admin") return "/(admin)";
  if (role === "owner") return "/(owner)";
  return "/(tenant)";
}

export function routeForUser(user: User) {
  if (user.role === "tenant" && user.must_change_password) return "/(auth)/change-password";
  return routeForRole(user.role);
}

export function routeAfterAuthentication(user: User, propertyId?: string) {
  if (user.role === "tenant" && user.must_change_password) {
    return propertyId
      ? `/(auth)/change-password?propertyId=${encodeURIComponent(propertyId)}`
      : routeForUser(user);
  }
  if (user.role === "tenant" && propertyId) return `/hostel/${encodeURIComponent(propertyId)}`;
  return routeForUser(user);
}

const processedSessions = new Set<string>();

function AuthRouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, refreshPolicyStatus, policyStatus, policyUserId } = useAuth();
  const pathname = usePathname();
  const segments = useSegments();
  const onPasswordChangeScreen = segments[0] === "(auth)" && segments[1] === "change-password";
  const onPolicyReviewScreen = segments[0] === "(tenant)" && segments[1] === "policy-review";
  const currentPolicyStatus = policyUserId === user?.id ? policyStatus : "idle";

  useEffect(() => {
    if (!loading && user?.role === "tenant" && !user.must_change_password) {
      void refreshPolicyStatus();
    }
  }, [loading, user?.id, user?.role, user?.must_change_password, refreshPolicyStatus]);

  if (loading && pathname !== "/") return null;
  if (!loading && user?.role === "tenant" && user.must_change_password && !onPasswordChangeScreen) {
    return <Redirect href={"/(auth)/change-password" as any} />;
  }
  if (!loading && user?.role === "tenant" && !user.must_change_password) {
    if ((currentPolicyStatus === "required" || currentPolicyStatus === "error") && !onPolicyReviewScreen) {
      return <Redirect href={"/(tenant)/policy-review" as any} />;
    }
    if (currentPolicyStatus === "idle" || currentPolicyStatus === "checking") {
      if (onPolicyReviewScreen) return <>{children}</>;
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }}>
          <ActivityIndicator size="large" color="#2C5E3E" />
        </View>
      );
    }
  }
  return <>{children}</>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(null);
  const [policy, setPolicy] = useState<{ userId: string | null; status: PolicyStatus }>({
    userId: null,
    status: "idle",
  });
  const currentUserId = user?.id;
  const currentUserRole = user?.role;
  const requiresPasswordChange = user?.must_change_password;

  const refreshPolicyStatus = useCallback(async (): Promise<"allowed" | "required" | "error"> => {
    if (!currentUserId || currentUserRole !== "tenant" || requiresPasswordChange) return "allowed";
    setPolicy((current) =>
      current.userId === currentUserId && current.status !== "idle"
        ? current
        : { userId: currentUserId, status: "checking" },
    );
    try {
      const result = await api.getWithTimeout<{ required: boolean }>(
        "/tenant/rules/pending",
        15000,
        "Could not check the latest hostel rules. Check your connection and retry.",
      );
      const status = result.required ? "required" : "allowed";
      setPolicy({ userId: currentUserId, status });
      return status;
    } catch {
      setPolicy({ userId: currentUserId, status: "error" });
      return "error";
    }
  }, [currentUserId, currentUserRole, requiresPasswordChange]);

  const completePolicyReview = useCallback(() => {
    if (user?.role === "tenant") setPolicy({ userId: user.id, status: "allowed" });
  }, [user]);

  const bootstrap = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User }>("/auth/me");
      setUser(user);
    } catch {
      setUser(null);
      setPolicy({ userId: null, status: "idle" });
      await setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const exchangeSession = useCallback(async (sessionId: string, propertyId?: string) => {
    if (processedSessions.has(sessionId)) return;
    processedSessions.add(sessionId);
    try {
      const res = await api.post<{ access_token: string; user: User }>("/auth/session", {
        session_id: sessionId,
      });
      await setToken(res.access_token);
      setUser(res.user);
      router.replace(routeAfterAuthentication(res.user, propertyId) as any);
    } catch {
      // ignore, stay on login
    }
  }, []);

  useEffect(() => {
    // Handle web google redirect (?session_id / #session_id)
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const hash = window.location.hash || "";
      const search = window.location.search || "";
      const m = (hash + search).match(/[?#&]session_id=([^&#]+)/);
      if (m) {
        const propertyMatch = (hash + search).match(/[?#&]propertyId=([^&#]+)/i);
        void Promise.resolve().then(() => exchangeSession(
          decodeURIComponent(m[1]),
          propertyMatch ? decodeURIComponent(propertyMatch[1]) : undefined,
        )).finally(() => {
          window.history.replaceState(window.history.state, "", window.location.pathname);
          setLoading(false);
        });
        return;
      }
    }
    void Promise.resolve().then(bootstrap);
    // mobile cold start deep link
    if (Platform.OS !== "web") {
      Linking.getInitialURL().then((url) => {
        if (url) {
          const m = url.match(/[?#&]session_id=([^&#]+)/);
          const propertyMatch = url.match(/[?&#]propertyId=([^&#]+)/i);
          if (m) exchangeSession(
            decodeURIComponent(m[1]),
            propertyMatch ? decodeURIComponent(propertyMatch[1]) : undefined,
          );
        }
      });
      const sub = Linking.addEventListener("url", ({ url }) => {
        const m = url.match(/[?#&]session_id=([^&#]+)/);
        const propertyMatch = url.match(/[?&#]propertyId=([^&#]+)/i);
        if (m) exchangeSession(
          decodeURIComponent(m[1]),
          propertyMatch ? decodeURIComponent(propertyMatch[1]) : undefined,
        );
      });
      return () => sub.remove();
    }
  }, [bootstrap, exchangeSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ access_token: string; user: User }>("/auth/login", { email, password });
    await setToken(res.access_token);
    setUser(res.user);
    return res.user;
  }, []);

  const loginWithGoogleToken = useCallback(async (idToken: string, propertyId?: string) => {
    try {
      const res = await api.post<{ access_token: string; user: User }>("/auth/google", {
        id_token: idToken,
      });
      await setToken(res.access_token);
      setUser(res.user);
      setPendingGoogleToken(null);
      router.replace(routeAfterAuthentication(res.user, propertyId) as any);
    } catch (error) {
      if (error instanceof ApiError && error.code === "google_link_required") {
        setPendingGoogleToken(idToken);
      }
      throw error;
    }
  }, []);

  const linkPendingGoogleAccount = useCallback(async () => {
    if (!pendingGoogleToken) return;
    await api.post<{ user: User }>("/auth/google/link", {
      id_token: pendingGoogleToken,
    });
    setPendingGoogleToken(null);
  }, [pendingGoogleToken]);

  const register = useCallback(
    async (body: { email: string; password: string; name: string; mobile?: string; role: "owner" | "tenant" }) => {
      const res = await api.post<{ access_token: string; user: User }>("/auth/register", body);
      await setToken(res.access_token);
      setUser(res.user);
      return res.user;
    },
    []
  );

  const changeTenantPassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await api.post<{ ok: boolean; user: User }>("/auth/password/change", {
      current_password: currentPassword,
      new_password: newPassword,
    });
    setUser(result.user);
    setPolicy({ userId: result.user.id, status: "idle" });
    return result.user;
  }, []);

  const loginWithGoogle = useCallback(async (propertyId?: string) => {
    if (Platform.OS !== "web" && isDirectGoogleSignInConfigured()) {
      const idToken = await signInWithGoogle();
      if (idToken) await loginWithGoogleToken(idToken, propertyId);
      return;
    }
    const redirectUrl =
      Platform.OS === "web"
        ? `${window.location.origin}/${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ""}`
        : Linking.createURL("", propertyId ? { queryParams: { propertyId } } : undefined);
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let url: string | null = null;
    if (result.type === "success" && result.url) url = result.url;
    if (!url) url = await Linking.getInitialURL();
    if (url) {
      const m = url.match(/[?#&]session_id=([^&#]+)/);
      if (m) await exchangeSession(decodeURIComponent(m[1]));
    }
  }, [exchangeSession, loginWithGoogleToken]);

  const logout = useCallback(async () => {
    await setToken(null);
    setUser(null);
    setPolicy({ userId: null, status: "idle" });
    router.replace("/(public)" as any);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User }>("/auth/me");
      setUser(user);
      if (user.role === "tenant" && !user.must_change_password) {
        await refreshPolicyStatus();
      }
    } catch {}
  }, [refreshPolicyStatus]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && user?.role === "tenant" && !user.must_change_password) {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh, user?.id, user?.role, user?.must_change_password]);

  useEffect(() => {
    if (user?.role !== "tenant" || user.must_change_password) return;
    const interval = setInterval(() => void refreshPolicyStatus(), 60000);
    return () => clearInterval(interval);
  }, [refreshPolicyStatus, user?.id, user?.role, user?.must_change_password]);

  return (
    <Ctx.Provider value={{
      user,
      loading,
      login,
      register,
      changeTenantPassword,
      loginWithGoogle,
      loginWithGoogleToken,
      linkPendingGoogleAccount,
      googleLinkPending: Boolean(pendingGoogleToken),
      logout,
      refresh,
      refreshPolicyStatus,
      completePolicyReview,
      policyStatus: policy.status,
      policyUserId: policy.userId,
    }}>
      <AuthRouteGuard>{children}</AuthRouteGuard>
    </Ctx.Provider>
  );
}
