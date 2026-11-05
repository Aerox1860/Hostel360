import { createContext, useContext } from "react";

export type TenantPolicyStatus = "checking" | "allowed" | "required" | "error";
export type TenantPolicyContextValue = {
  status: TenantPolicyStatus;
  setStatus: (status: "allowed" | "required") => void;
  retry: () => void;
};

export const TenantPolicyContext = createContext<TenantPolicyContextValue | null>(null);

export function useTenantPolicy() {
  const value = useContext(TenantPolicyContext);
  if (!value) throw new Error("useTenantPolicy must be used inside TenantArea.");
  return value;
}
