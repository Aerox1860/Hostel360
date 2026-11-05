import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

export type HostelSummary = {
  id: string;
  name: string;
  city?: string;
  area?: string;
  address?: string;
  status?: string;
  property_type?: string;
};

type OwnerContextValue = {
  hostels: HostelSummary[];
  activeId: string;
  activeHostel: HostelSummary | null;
  loading: boolean;
  error: string;
  setActiveId: (id: string) => void;
  refresh: () => Promise<HostelSummary[]>;
};

const OwnerContext = createContext<OwnerContextValue | null>(null);
const ACTIVE_KEY = "hostel360.activeHostelId";

export function OwnerProvider({ children }: { children: React.ReactNode }) {
  const [hostels, setHostels] = useState<HostelSummary[]>([]);
  const [activeId, setActive] = useState(() => localStorage.getItem(ACTIVE_KEY) || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    const result = await api.get<{ hostels: HostelSummary[] }>("/owner/hostels");
    const records = result.hostels || [];
    setHostels(records);
    setActive((current) => {
      const selected = records.some((item) => item.id === current) ? current : records[0]?.id || "";
      if (selected) localStorage.setItem(ACTIVE_KEY, selected);
      else localStorage.removeItem(ACTIVE_KEY);
      return selected;
    });
    return records;
  }, []);

  useEffect(() => {
    refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load hostels."))
      .finally(() => setLoading(false));
  }, [refresh]);

  const setActiveId = useCallback((id: string) => {
    setActive(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  }, []);

  const value = useMemo(() => ({
    hostels,
    activeId,
    activeHostel: hostels.find((item) => item.id === activeId) || null,
    loading,
    error,
    setActiveId,
    refresh,
  }), [hostels, activeId, loading, error, setActiveId, refresh]);
  return <OwnerContext.Provider value={value}>{children}</OwnerContext.Provider>;
}

export function useOwnerHostel() {
  const value = useContext(OwnerContext);
  if (!value) throw new Error("useOwnerHostel must be used inside OwnerProvider.");
  return value;
}
