import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

const ACTIVE_KEY = "hostel360.activeHostelId";

interface OwnerHostelCtx {
  hostels: any[];
  activeId: string | null;
  activeHostel: any | null;
  loading: boolean;
  setActive: (id: string) => void;
  refresh: () => Promise<any[]>;
}

const Ctx = createContext<OwnerHostelCtx>({} as OwnerHostelCtx);
export const useOwnerHostel = () => useContext(Ctx);

export function OwnerHostelProvider({ children }: { children: React.ReactNode }) {
  const [hostels, setHostels] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { hostels } = await api.get<{ hostels: any[] }>("/owner/hostels");
      setHostels(hostels);
      const stored = await storage.getItem<string>(ACTIVE_KEY, "");
      setActiveId((prev) => {
        const candidate = prev || stored || "";
        const valid = hostels.find((h) => h.id === candidate);
        return valid ? candidate : hostels[0]?.id || null;
      });
      return hostels;
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    storage.setItem(ACTIVE_KEY, id);
  }, []);

  const activeHostel = hostels.find((h) => h.id === activeId) || null;

  return (
    <Ctx.Provider value={{ hostels, activeId, activeHostel, loading, setActive, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
