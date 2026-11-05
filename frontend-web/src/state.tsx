import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, api, tokenStore } from "./api";

export type User = {
  id: string;
  name?: string;
  email: string;
  mobile?: string;
  role: "owner" | "tenant" | "admin";
  must_change_password?: boolean;
  hostel_id?: string | null;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  register: (body: Record<string, unknown>) => Promise<User>;
  loginWithGoogleToken: (idToken: string, propertyId?: string) => Promise<User>;
  linkPendingGoogleAccount: () => Promise<void>;
  googleLinkPending: boolean;
  changePassword: (currentPassword: string, newPassword: string) => Promise<User>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    if (!tokenStore.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const result = await api.get<{ user: User }>("/auth/me");
      setUser(result.user);
    } catch (reason) {
      setUser(null);
      const status = reason instanceof ApiError ? reason.status : 0;
      if (status === 0 || status >= 500) setError(reason instanceof Error ? reason.message : "Could not restore your session.");
      else tokenStore.set(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ access_token: string; user: User }>("/auth/login", { email, password });
    tokenStore.set(result.access_token);
    setUser(result.user);
    return result.user;
  }, []);

  const register = useCallback(async (body: Record<string, unknown>) => {
    const result = await api.post<{ access_token: string; user: User }>("/auth/register", body);
    tokenStore.set(result.access_token);
    setUser(result.user);
    return result.user;
  }, []);

  const loginWithGoogleToken = useCallback(async (idToken: string, propertyId?: string) => {
    try {
      const result = await api.post<{ access_token: string; user: User }>("/auth/google", {
        id_token: idToken,
        ...(propertyId ? { property_id: propertyId } : {}),
      });
      tokenStore.set(result.access_token);
      setUser(result.user);
      setPendingGoogleToken(null);
      return result.user;
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "google_link_required") setPendingGoogleToken(idToken);
      throw reason;
    }
  }, []);

  const linkPendingGoogleAccount = useCallback(async () => {
    if (!pendingGoogleToken) return;
    try { await api.post("/auth/google/link", { id_token: pendingGoogleToken }); }
    finally { setPendingGoogleToken(null); }
  }, [pendingGoogleToken]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await api.post<{ user: User }>("/auth/password/change", {
      current_password: currentPassword,
      new_password: newPassword,
    });
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setPendingGoogleToken(null);
    setError("");
  }, []);

  const value = useMemo(
    () => ({
      user, loading, error, refresh, login, register, loginWithGoogleToken, linkPendingGoogleAccount,
      googleLinkPending: Boolean(pendingGoogleToken), changePassword, logout,
    }),
    [user, loading, error, refresh, login, register, loginWithGoogleToken, linkPendingGoogleAccount, pendingGoogleToken, changePassword, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
