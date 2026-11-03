import { useSyncExternalStore } from "react";

/** True while the media query matches; follows resizes and rotations. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's `xl`: where list + detail pages show both side by side. */
export const WIDE = "(min-width: 80rem)";
