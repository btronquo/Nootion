import { useSyncExternalStore } from "react";
import { t } from "@nootion/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The server couldn't be reached (no network, or the server is down behind its proxy). */
export const isOfflineError = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 0;

// Whether the last request reached the server. Answers served from the offline copy don't count.
let reachable = true;
const listeners = new Set<() => void>();
function setReachable(value: boolean) {
  if (value === reachable) return;
  reachable = value;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
};
export const isOnline = () => navigator.onLine && reachable;
/** False while the device is offline or the server can't be reached. */
export const useOnline = () => useSyncExternalStore(subscribe, isOnline);

/** Status codes of a reverse proxy whose server is down: same as being offline. */
const GATEWAY_ERRORS = new Set([502, 503, 504]);

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return (await request<T>(path, init)).data as T;
}

/**
 * A GET answered "not modified" (data: null) when the server's version is still `etag`, so that refreshing a large
 * answer that didn't change costs neither the download nor the parsing.
 */
export function apiIfChanged<T>(path: string, etag: string | null | undefined) {
  return request<T>(path, { etag });
}

async function request<T>(path: string, init: { method?: string; body?: unknown; etag?: string | null }): Promise<{ data: T | null; etag: string | null }> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.etag) headers["if-none-match"] = init.etag;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    setReachable(false);
    throw new ApiError(0, "offline", t("offline.unavailable"));
  }
  if (GATEWAY_ERRORS.has(res.status)) {
    setReachable(false);
    throw new ApiError(0, "offline", t("offline.unavailable"));
  }
  // The service worker marks the answers it takes from its offline copy.
  setReachable(!res.headers.has("x-nootion-offline"));
  if (res.status === 304 && init.etag) return { data: null, etag: init.etag };
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? t("common.errorStatus", { status: res.status }));
  }
  return { data: data as T, etag: res.headers.get("etag") };
}
