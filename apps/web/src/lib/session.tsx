import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicUser } from "@nootion/shared";
import { api, ApiError } from "./api";

interface SessionState {
  user: PublicUser | null;
  needsSetup: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => api<{ needsSetup: boolean }>("/setup") });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api<{ user: PublicUser }>("/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
  const value: SessionState = {
    user: me.data ?? null,
    needsSetup: setup.data?.needsSetup ?? false,
    loading: setup.isLoading || me.isLoading,
    refresh: async () => {
      // Reset every cached query so nothing from a previous account leaks into the next one.
      await qc.resetQueries();
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
