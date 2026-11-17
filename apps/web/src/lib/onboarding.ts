import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OnboardingState } from "@nootion/shared";
import { api } from "./api";

export const onboardingKey = ["onboarding"];

/** What to offer the signed-in person: the guided tour, and (administrators of a new server) the setup assistant. */
export function useOnboarding(enabled = true) {
  return useQuery({
    queryKey: onboardingKey,
    queryFn: () => api<OnboardingState>("/onboarding"),
    staleTime: Infinity,
    retry: false,
    enabled,
  });
}

const EVENT = "nootion:tour";

/** Opens the guided tour again (from My account, the palette, the end of the setup assistant). */
export function startTour() {
  window.dispatchEvent(new Event(EVENT));
}

export function useTourRequests(open: () => void) {
  useEffect(() => {
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, [open]);
}
