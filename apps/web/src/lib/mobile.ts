import { useSyncExternalStore } from "react";

function useMedia(query: string): boolean {
  const media = window.matchMedia(query);
  return useSyncExternalStore(
    (onChange) => {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => media.matches,
  );
}

/** Phone-sized screen: the sidebar becomes a drawer and database tables show as cards. */
export const useIsMobile = () => useMedia("(max-width: 767px)");

/** Touch screen without a mouse: no hover, so actions shown on hover stay visible. */
export const useIsTouch = () => useMedia("(hover: none) and (pointer: coarse)");
