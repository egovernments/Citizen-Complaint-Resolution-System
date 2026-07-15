import { useEffect, useState } from "react";

const QUERIES = {
  sm: "(max-width: 639px)",
  md: "(min-width: 640px) and (max-width: 1023px)",
  lg: "(min-width: 1024px)",
};

function getBreakpoint() {
  if (typeof window === "undefined") return "lg";
  if (window.matchMedia(QUERIES.sm).matches) return "sm";
  if (window.matchMedia(QUERIES.md).matches) return "md";
  return "lg";
}

/**
 * Returns the active dashboard viewport bucket: `sm`, `md`, or `lg`.
 * Used for display-only layout adaptation — persisted layout stays desktop-oriented.
 */
export default function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState(getBreakpoint);

  useEffect(() => {
    const mediaLists = Object.values(QUERIES).map((query) => window.matchMedia(query));
    const sync = () => setBreakpoint(getBreakpoint());

    mediaLists.forEach((mql) => {
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", sync);
      } else {
        mql.addListener(sync);
      }
    });

    sync();
    return () => {
      mediaLists.forEach((mql) => {
        if (typeof mql.removeEventListener === "function") {
          mql.removeEventListener("change", sync);
        } else {
          mql.removeListener(sync);
        }
      });
    };
  }, []);

  return breakpoint;
}
