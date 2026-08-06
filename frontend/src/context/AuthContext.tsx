import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { api, setToken } from "@/src/api/client";

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
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function routeForRole(role: Role) {
  if (role === "admin") return "/(admin)";
  if (role === "owner") return "/(owner)";
  return "/(tenant)";
}

const processedSessions = new Set<string>();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User }>("/auth/me");
      setUser(user);
    } catch {
      setUser(null);
      await setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const exchangeSession = useCallback(async (sessionId: string) => {
    if (processedSessions.has(sessionId)) return;
    processedSessions.add(sessionId);
    try {
      const res = await api.post<{ access_token: string; user: User }>("/auth/session", {
        session_id: sessionId,
      });
      await setToken(res.access_token);
      setUser(res.user);
      router.replace(routeForRole(res.user.role) as any);
    } catch (e) {
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
        exchangeSession(decodeURIComponent(m[1])).finally(() => {
          window.history.replaceState(window.history.state, "", window.location.pathname);
        });
        setLoading(false);
        return;
      }
    }
    bootstrap();
    // mobile cold start deep link
    if (Platform.OS !== "web") {
      Linking.getInitialURL().then((url) => {
        if (url) {
          const m = url.match(/[?#&]session_id=([^&#]+)/);
          if (m) exchangeSession(decodeURIComponent(m[1]));
        }
      });
      const sub = Linking.addEventListener("url", ({ url }) => {
        const m = url.match(/[?#&]session_id=([^&#]+)/);
        if (m) exchangeSession(decodeURIComponent(m[1]));
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

  const register = useCallback(
    async (body: { email: string; password: string; name: string; mobile?: string; role: "owner" | "tenant" }) => {
      const res = await api.post<{ access_token: string; user: User }>("/auth/register", body);
      await setToken(res.access_token);
      setUser(res.user);
      return res.user;
    },
    []
  );

  const loginWithGoogle = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web" ? window.location.origin + "/" : Linking.createURL("");
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
  }, [exchangeSession]);

  const logout = useCallback(async () => {
    await setToken(null);
    setUser(null);
    router.replace("/(public)" as any);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User }>("/auth/me");
      setUser(user);
    } catch {}
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, login, register, loginWithGoogle, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
